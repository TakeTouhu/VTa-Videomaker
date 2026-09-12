//! Vision analysis: keyframe extraction, and object / face detection through a
//! pluggable external detector (design doc section 57).
//!
//! No model is bundled. Detection is delegated either to an external executable
//! the user configures, or to a vision-capable model through the provider layer
//! in the UI. Both return the same `Detection` list, so semantic search and
//! masking do not care which produced it.

use crate::error::{CoreError, CoreResult};
use crate::ffmpeg::{ffmpeg_binary, run};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;

/// A detected object or face, in normalised 0..1 frame coordinates so the box
/// stays correct at any resolution or proxy scale.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Detection {
    pub label: String,
    pub confidence: f64,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// Detections for one sampled frame.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameDetections {
    pub time: f64,
    pub detections: Vec<Detection>,
}

/// One analysed keyframe: the image on disk plus whatever was found in it.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Keyframe {
    pub time: f64,
    pub path: String,
}

/// Extracts one still per `interval` seconds, for detection or a vision model.
pub fn extract_keyframes(
    source: &Path,
    directory: &Path,
    interval: f64,
    max_width: u32,
) -> CoreResult<Vec<Keyframe>> {
    std::fs::create_dir_all(directory)?;

    let pattern = directory.join("frame-%05d.jpg");
    let fps = if interval > 0.0 { 1.0 / interval } else { 1.0 };

    run(Command::new(ffmpeg_binary()).args([
        "-y",
        "-v",
        "error",
        "-i",
        &source.display().to_string(),
        "-vf",
        &format!("fps={fps:.6},scale={max_width}:-2"),
        "-q:v",
        "4",
        &pattern.display().to_string(),
    ]))?;

    collect_keyframes(directory, interval)
}

/// Pairs the written frames with the timestamps they were sampled at.
pub fn collect_keyframes(directory: &Path, interval: f64) -> CoreResult<Vec<Keyframe>> {
    let mut paths: Vec<PathBuf> = std::fs::read_dir(directory)?
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.extension().and_then(|e| e.to_str()) == Some("jpg"))
        .collect();
    paths.sort();

    Ok(paths
        .into_iter()
        .enumerate()
        .map(|(index, path)| Keyframe {
            // ffmpeg writes the first frame at t=0, then one per interval.
            time: index as f64 * interval,
            path: path.display().to_string(),
        })
        .collect())
}

/// Runs an external detector over a frame and parses its JSON output.
///
/// The contract is deliberately minimal so any detector can be adapted with a
/// few lines of wrapper script:
///   `<binary> <image path>` -> JSON array of
///   `{label, confidence, x, y, width, height}` in normalised coordinates.
pub fn detect_in_frame(binary: &str, image: &Path) -> CoreResult<Vec<Detection>> {
    let output = Command::new(binary)
        .arg(image.display().to_string())
        .output()
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                CoreError::Other(format!("物体検出コマンドが見つかりません: {binary}"))
            } else {
                CoreError::Io(error)
            }
        })?;

    if !output.status.success() {
        return Err(CoreError::Other(format!(
            "物体検出に失敗しました: {}",
            String::from_utf8_lossy(&output.stderr)
                .lines()
                .last()
                .unwrap_or("unknown error")
        )));
    }

    parse_detections(&String::from_utf8_lossy(&output.stdout))
}

/// Parses and sanitises detector output. Boxes outside the frame are clamped,
/// and entries that are not usable are dropped rather than failing the batch.
pub fn parse_detections(json: &str) -> CoreResult<Vec<Detection>> {
    let value: serde_json::Value = serde_json::from_str(json.trim())?;
    let array = value
        .as_array()
        .or_else(|| value.get("detections").and_then(|d| d.as_array()))
        .ok_or_else(|| CoreError::Other("検出結果がJSON配列ではありません".into()))?;

    Ok(array
        .iter()
        .filter_map(|entry| {
            let label = entry.get("label")?.as_str()?.to_string();
            let read = |key: &str| entry.get(key).and_then(|v| v.as_f64()).unwrap_or(0.0);

            let width = clamp01(read("width"));
            let height = clamp01(read("height"));
            if width <= 0.0 || height <= 0.0 {
                return None;
            }
            Some(Detection {
                label,
                confidence: clamp01(
                    entry
                        .get("confidence")
                        .and_then(|v| v.as_f64())
                        .unwrap_or(1.0),
                ),
                x: clamp01(read("x")),
                y: clamp01(read("y")),
                width,
                height,
            })
        })
        .collect())
}

fn clamp01(value: f64) -> f64 {
    if value.is_finite() {
        value.clamp(0.0, 1.0)
    } else {
        0.0
    }
}

/// Distinct labels seen across a set of frames, most frequent first. Used by
/// natural language media search (design doc section 47).
pub fn summarise_labels(frames: &[FrameDetections]) -> Vec<(String, usize)> {
    let mut counts: std::collections::HashMap<&str, usize> = std::collections::HashMap::new();
    for frame in frames {
        for detection in &frame.detections {
            *counts.entry(detection.label.as_str()).or_default() += 1;
        }
    }

    let mut labels: Vec<(String, usize)> = counts
        .into_iter()
        .map(|(label, count)| (label.to_string(), count))
        .collect();
    labels.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    labels
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_detector_output() {
        let json =
            r#"[{"label":"person","confidence":0.92,"x":0.1,"y":0.2,"width":0.3,"height":0.4}]"#;
        let detections = parse_detections(json).unwrap();
        assert_eq!(detections.len(), 1);
        assert_eq!(detections[0].label, "person");
        assert!((detections[0].confidence - 0.92).abs() < 1e-6);
    }

    #[test]
    fn accepts_a_wrapped_object_as_well_as_a_bare_array() {
        let json = r#"{"detections":[{"label":"face","x":0,"y":0,"width":0.5,"height":0.5}]}"#;
        assert_eq!(parse_detections(json).unwrap().len(), 1);
    }

    #[test]
    fn clamps_boxes_into_the_frame() {
        let json = r#"[{"label":"a","x":-1,"y":2,"width":5,"height":0.5}]"#;
        let detection = &parse_detections(json).unwrap()[0];
        assert_eq!(detection.x, 0.0);
        assert_eq!(detection.y, 1.0);
        assert_eq!(detection.width, 1.0);
    }

    #[test]
    fn drops_a_box_with_no_area() {
        let json = r#"[{"label":"a","x":0,"y":0,"width":0,"height":0.5}]"#;
        assert!(parse_detections(json).unwrap().is_empty());
    }

    #[test]
    fn drops_an_entry_without_a_label() {
        let json = r#"[{"confidence":0.9,"x":0,"y":0,"width":0.5,"height":0.5}]"#;
        assert!(parse_detections(json).unwrap().is_empty());
    }

    #[test]
    fn rejects_output_that_is_not_json() {
        assert!(parse_detections("not json at all").is_err());
    }

    #[test]
    fn defaults_confidence_when_the_detector_omits_it() {
        let json = r#"[{"label":"a","x":0,"y":0,"width":0.5,"height":0.5}]"#;
        assert_eq!(parse_detections(json).unwrap()[0].confidence, 1.0);
    }

    #[test]
    fn summarises_labels_by_frequency() {
        let frames = vec![
            FrameDetections {
                time: 0.0,
                detections: parse_detections(
                    r#"[{"label":"person","x":0,"y":0,"width":1,"height":1},
                        {"label":"dog","x":0,"y":0,"width":1,"height":1}]"#,
                )
                .unwrap(),
            },
            FrameDetections {
                time: 1.0,
                detections: parse_detections(
                    r#"[{"label":"person","x":0,"y":0,"width":1,"height":1}]"#,
                )
                .unwrap(),
            },
        ];
        let labels = summarise_labels(&frames);
        assert_eq!(labels[0], ("person".to_string(), 2));
        assert_eq!(labels[1], ("dog".to_string(), 1));
    }
}
