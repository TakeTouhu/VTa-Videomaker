//! Silence detection via FFmpeg's silencedetect filter.

use crate::ai::SilenceRange;
use crate::error::CoreResult;
use crate::ffmpeg::{ffmpeg_binary, run};
use std::path::Path;
use std::process::Command;

/// Default threshold. -30 dB over 0.5 s matches what reads as a pause in
/// speech without cutting breaths.
pub const DEFAULT_NOISE_DB: f64 = -30.0;
pub const DEFAULT_MIN_DURATION: f64 = 0.5;

pub fn detect(path: &Path, noise_db: f64, min_duration: f64) -> CoreResult<Vec<SilenceRange>> {
    let output = run(Command::new(ffmpeg_binary()).args([
        "-i",
        &path.display().to_string(),
        "-af",
        &format!("silencedetect=noise={noise_db}dB:d={min_duration}"),
        "-f",
        "null",
        "-",
    ]))?;

    Ok(parse_silencedetect(&String::from_utf8_lossy(
        &output.stderr,
    )))
}

/// Parses the `silence_start` / `silence_end` pairs FFmpeg logs to stderr.
///
/// A trailing `silence_start` with no matching end (the file ends in silence)
/// is dropped rather than guessed at.
pub fn parse_silencedetect(stderr: &str) -> Vec<SilenceRange> {
    let mut ranges = Vec::new();
    let mut pending_start: Option<f64> = None;

    for line in stderr.lines() {
        if let Some(index) = line.find("silence_start:") {
            let value = line[index + "silence_start:".len()..]
                .split_whitespace()
                .next()
                .and_then(|value| value.parse::<f64>().ok());
            pending_start = value;
        } else if let Some(index) = line.find("silence_end:") {
            let end = line[index + "silence_end:".len()..]
                .split_whitespace()
                .next()
                .and_then(|value| value.parse::<f64>().ok());

            if let (Some(start), Some(end)) = (pending_start.take(), end) {
                if end > start {
                    ranges.push(SilenceRange { start, end });
                }
            }
        }
    }
    ranges
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "\
[silencedetect @ 0x1] silence_start: 1.5
[silencedetect @ 0x1] silence_end: 3.25 | silence_duration: 1.75
[silencedetect @ 0x1] silence_start: 10.0
[silencedetect @ 0x1] silence_end: 12.5 | silence_duration: 2.5
";

    #[test]
    fn parses_silence_pairs() {
        let ranges = parse_silencedetect(SAMPLE);
        assert_eq!(ranges.len(), 2);
        assert_eq!(ranges[0].start, 1.5);
        assert_eq!(ranges[0].end, 3.25);
        assert_eq!(ranges[1].end, 12.5);
    }

    #[test]
    fn drops_an_unterminated_silence() {
        let ranges = parse_silencedetect("silence_start: 5.0\n");
        assert!(ranges.is_empty());
    }

    #[test]
    fn ignores_unrelated_output() {
        let ranges = parse_silencedetect("frame= 100 fps=25\nPress [q] to stop\n");
        assert!(ranges.is_empty());
    }

    #[test]
    fn rejects_a_range_that_ends_before_it_starts() {
        let ranges = parse_silencedetect("silence_start: 5.0\nsilence_end: 4.0\n");
        assert!(ranges.is_empty());
    }
}
