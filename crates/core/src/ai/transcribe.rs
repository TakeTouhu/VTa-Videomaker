//! Speech to text (design doc section 20).
//!
//! Transcription is delegated to an external engine so the app does not bundle
//! a model. Two engines are supported out of the box:
//!
//! - `whisper.cpp` style local binaries, which emit SRT or JSON next to the
//!   input. Fully offline.
//! - A hosted API, driven from the TypeScript provider layer, which hands the
//!   resulting segments back through `analyze_media`.
//!
//! Both produce the same `TranscriptSegment` list, so nothing downstream cares
//! which was used.

use crate::ai::TranscriptSegment;
use crate::error::{CoreError, CoreResult};
use std::path::Path;
use std::process::Command;

/// How the local engine is invoked. Configured in app settings; absent means
/// local transcription is unavailable and the hosted provider must be used.
#[derive(Debug, Clone)]
pub struct LocalEngine {
    /// Path to the executable, e.g. whisper-cli.
    pub binary: String,
    /// Model file passed to the executable.
    pub model: String,
    /// ISO language code, or "auto".
    pub language: String,
}

/// Runs the local engine and parses its SRT output.
pub fn transcribe_local(engine: &LocalEngine, audio: &Path) -> CoreResult<Vec<TranscriptSegment>> {
    let output_base = audio.with_extension("");

    let output = Command::new(&engine.binary)
        .args([
            "-m",
            &engine.model,
            "-l",
            &engine.language,
            "-osrt",
            "-of",
            &output_base.display().to_string(),
            "-f",
            &audio.display().to_string(),
        ])
        .output()
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                CoreError::Other(format!(
                    "音声認識エンジンが見つかりません: {}",
                    engine.binary
                ))
            } else {
                CoreError::Io(error)
            }
        })?;

    if !output.status.success() {
        return Err(CoreError::Other(format!(
            "音声認識に失敗しました: {}",
            String::from_utf8_lossy(&output.stderr)
                .lines()
                .last()
                .unwrap_or("unknown error")
        )));
    }

    let srt_path = output_base.with_extension("srt");
    let srt = std::fs::read_to_string(&srt_path)?;
    let _ = std::fs::remove_file(&srt_path);

    Ok(parse_srt(&srt))
}

/// Parses SRT subtitles into timed transcript segments.
///
/// Malformed blocks are skipped rather than failing the whole transcript - a
/// single bad cue should not lose an hour of speech.
pub fn parse_srt(srt: &str) -> Vec<TranscriptSegment> {
    let mut segments = Vec::new();

    for block in srt.split("\n\n").flat_map(|b| b.split("\r\n\r\n")) {
        let lines: Vec<&str> = block
            .lines()
            .map(str::trim)
            .filter(|l| !l.is_empty())
            .collect();
        if lines.len() < 2 {
            continue;
        }

        // The timing line is either the first or second line depending on
        // whether the cue is numbered.
        let timing = lines.iter().find(|line| line.contains("-->"));
        let Some(timing) = timing else { continue };
        let Some((start, end)) = parse_timing(timing) else {
            continue;
        };

        let text: String = lines
            .iter()
            .skip_while(|line| !line.contains("-->"))
            .skip(1)
            .copied()
            .collect::<Vec<&str>>()
            .join(" ");

        if text.trim().is_empty() || end <= start {
            continue;
        }
        segments.push(TranscriptSegment {
            start,
            end,
            text: text.trim().to_string(),
            confidence: None,
        });
    }
    segments
}

fn parse_timing(line: &str) -> Option<(f64, f64)> {
    let (start, end) = line.split_once("-->")?;
    Some((parse_timestamp(start.trim())?, parse_timestamp(end.trim())?))
}

/// `HH:MM:SS,mmm` (SRT) or `HH:MM:SS.mmm` (WebVTT).
fn parse_timestamp(value: &str) -> Option<f64> {
    let normalized = value.replace(',', ".");
    let parts: Vec<&str> = normalized.split(':').collect();
    let (hours, minutes, seconds) = match parts.as_slice() {
        [h, m, s] => (
            h.parse::<f64>().ok()?,
            m.parse::<f64>().ok()?,
            s.parse::<f64>().ok()?,
        ),
        [m, s] => (0.0, m.parse::<f64>().ok()?, s.parse::<f64>().ok()?),
        _ => return None,
    };
    Some(hours * 3600.0 + minutes * 60.0 + seconds)
}

/// Serialises a transcript back to SRT, used by caption export.
pub fn to_srt(segments: &[TranscriptSegment]) -> String {
    segments
        .iter()
        .enumerate()
        .map(|(index, segment)| {
            format!(
                "{}\n{} --> {}\n{}\n",
                index + 1,
                format_timestamp(segment.start),
                format_timestamp(segment.end),
                segment.text
            )
        })
        .collect::<Vec<String>>()
        .join("\n")
}

pub fn format_timestamp(seconds: f64) -> String {
    let clamped = seconds.max(0.0);
    let hours = (clamped / 3600.0).floor() as u64;
    let minutes = ((clamped % 3600.0) / 60.0).floor() as u64;
    let secs = (clamped % 60.0).floor() as u64;
    let millis = ((clamped - clamped.floor()) * 1000.0).round() as u64;
    format!("{hours:02}:{minutes:02}:{secs:02},{millis:03}")
}

#[cfg(test)]
mod tests {
    use super::*;

    const SRT: &str = "1\n00:00:01,000 --> 00:00:03,500\n今日はAIについて説明します\n\n2\n00:00:04,000 --> 00:00:06,250\nまず全体像から見ていきます\n";

    #[test]
    fn parses_srt_into_timed_segments() {
        let segments = parse_srt(SRT);
        assert_eq!(segments.len(), 2);
        assert_eq!(segments[0].start, 1.0);
        assert_eq!(segments[0].end, 3.5);
        assert_eq!(segments[0].text, "今日はAIについて説明します");
        assert_eq!(segments[1].start, 4.0);
    }

    #[test]
    fn joins_multi_line_cues() {
        let srt = "1\n00:00:00,000 --> 00:00:02,000\nline one\nline two\n";
        assert_eq!(parse_srt(srt)[0].text, "line one line two");
    }

    #[test]
    fn skips_a_malformed_block_without_losing_the_rest() {
        let srt = format!("garbage block\n\n{SRT}");
        assert_eq!(parse_srt(&srt).len(), 2);
    }

    #[test]
    fn skips_a_cue_that_ends_before_it_starts() {
        let srt = "1\n00:00:05,000 --> 00:00:02,000\nbackwards\n";
        assert!(parse_srt(srt).is_empty());
    }

    #[test]
    fn accepts_webvtt_style_timestamps() {
        let srt = "00:00:01.500 --> 00:00:02.500\nhello\n";
        assert_eq!(parse_srt(srt)[0].start, 1.5);
    }

    #[test]
    fn round_trips_through_srt() {
        let segments = parse_srt(SRT);
        let reparsed = parse_srt(&to_srt(&segments));
        assert_eq!(reparsed.len(), segments.len());
        assert_eq!(reparsed[0].text, segments[0].text);
        assert!((reparsed[0].start - segments[0].start).abs() < 1e-3);
    }

    #[test]
    fn formats_timestamps_for_srt() {
        assert_eq!(format_timestamp(3661.5), "01:01:01,500");
        assert_eq!(format_timestamp(0.0), "00:00:00,000");
    }
}
