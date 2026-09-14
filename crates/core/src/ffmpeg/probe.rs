//! ffprobe wrapper: reads duration, resolution, fps and audio layout.

use crate::error::{CoreError, CoreResult};
use crate::ffmpeg::{ffprobe_binary, run};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MediaProbe {
    pub duration: f64,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub fps: Option<f64>,
    pub audio_channels: Option<u32>,
    pub has_video: bool,
    pub has_audio: bool,
    pub codec: Option<String>,
}

pub fn probe(path: &Path) -> CoreResult<MediaProbe> {
    if !path.exists() {
        return Err(CoreError::FileNotFound(path.display().to_string()));
    }

    let output = run(Command::new(ffprobe_binary()).args([
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        &path.display().to_string(),
    ]))?;

    let json: serde_json::Value = serde_json::from_slice(&output.stdout)?;
    parse_probe_json(&json)
}

/// Split out from `probe` so it can be unit tested without ffprobe installed.
pub fn parse_probe_json(json: &serde_json::Value) -> CoreResult<MediaProbe> {
    let streams = json
        .get("streams")
        .and_then(|value| value.as_array())
        .ok_or_else(|| CoreError::MediaCorrupt("ffprobe returned no streams".into()))?;

    let mut result = MediaProbe {
        duration: json
            .get("format")
            .and_then(|format| format.get("duration"))
            .and_then(|value| value.as_str())
            .and_then(|value| value.parse::<f64>().ok())
            .unwrap_or(0.0),
        ..Default::default()
    };

    for stream in streams {
        match stream.get("codec_type").and_then(|value| value.as_str()) {
            Some("video") => {
                result.has_video = true;
                result.width = stream
                    .get("width")
                    .and_then(|v| v.as_u64())
                    .map(|v| v as u32);
                result.height = stream
                    .get("height")
                    .and_then(|v| v.as_u64())
                    .map(|v| v as u32);
                result.fps = stream
                    .get("avg_frame_rate")
                    .and_then(|value| value.as_str())
                    .and_then(parse_frame_rate);
                result.codec = stream
                    .get("codec_name")
                    .and_then(|value| value.as_str())
                    .map(str::to_string);
            }
            Some("audio") => {
                result.has_audio = true;
                result.audio_channels = stream
                    .get("channels")
                    .and_then(|value| value.as_u64())
                    .map(|value| value as u32);
            }
            _ => {}
        }
    }

    if !result.has_video && !result.has_audio {
        return Err(CoreError::MediaCorrupt(
            "file contains no audio or video stream".into(),
        ));
    }
    Ok(result)
}

/// ffprobe reports frame rates as a rational string such as "30000/1001".
fn parse_frame_rate(value: &str) -> Option<f64> {
    let (numerator, denominator) = value.split_once('/')?;
    let numerator: f64 = numerator.parse().ok()?;
    let denominator: f64 = denominator.parse().ok()?;
    if denominator == 0.0 {
        return None;
    }
    Some(numerator / denominator)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_ntsc_frame_rate() {
        let fps = parse_frame_rate("30000/1001").unwrap();
        assert!((fps - 29.97).abs() < 0.01);
    }

    #[test]
    fn rejects_zero_denominator() {
        assert!(parse_frame_rate("0/0").is_none());
    }

    #[test]
    fn parses_probe_output() {
        let json = serde_json::json!({
            "format": { "duration": "12.5" },
            "streams": [
                { "codec_type": "video", "width": 1920, "height": 1080,
                  "avg_frame_rate": "30/1", "codec_name": "h264" },
                { "codec_type": "audio", "channels": 2 }
            ]
        });
        let probe = parse_probe_json(&json).unwrap();
        assert_eq!(probe.duration, 12.5);
        assert_eq!(probe.width, Some(1920));
        assert_eq!(probe.audio_channels, Some(2));
        assert!(probe.has_video && probe.has_audio);
    }

    #[test]
    fn rejects_file_without_streams() {
        let json = serde_json::json!({ "format": { "duration": "1.0" }, "streams": [] });
        assert!(parse_probe_json(&json).is_err());
    }
}
