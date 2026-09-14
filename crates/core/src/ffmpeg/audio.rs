//! Audio extraction for the analysis pipeline (design doc section 20).
//!
//!   Video -> Audio Extraction -> Speech To Text -> Transcript

use crate::error::CoreResult;
use crate::ffmpeg::{ffmpeg_binary, run};
use std::path::{Path, PathBuf};
use std::process::Command;

/// 16 kHz mono is what every speech model in common use expects, and it keeps
/// the uploaded file small for hosted transcription.
pub const SPEECH_SAMPLE_RATE: u32 = 16_000;

/// Extracts the audio track to a mono 16 kHz WAV file.
pub fn extract_for_speech(source: &Path, destination: &Path) -> CoreResult<PathBuf> {
    if let Some(parent) = destination.parent() {
        std::fs::create_dir_all(parent)?;
    }

    run(Command::new(ffmpeg_binary()).args([
        "-y",
        "-v",
        "error",
        "-i",
        &source.display().to_string(),
        "-vn",
        "-ac",
        "1",
        "-ar",
        &SPEECH_SAMPLE_RATE.to_string(),
        "-c:a",
        "pcm_s16le",
        &destination.display().to_string(),
    ]))?;

    Ok(destination.to_path_buf())
}

/// Measures integrated loudness with EBU R128, used by AI audio correction.
///
/// Returns (integrated LUFS, true peak dB).
pub fn measure_loudness(source: &Path) -> CoreResult<(f64, f64)> {
    let output = run(Command::new(ffmpeg_binary()).args([
        "-i",
        &source.display().to_string(),
        "-af",
        "loudnorm=print_format=json",
        "-f",
        "null",
        "-",
    ]))?;

    parse_loudnorm(&String::from_utf8_lossy(&output.stderr))
}

/// loudnorm prints a JSON object at the end of stderr, after the usual log.
pub fn parse_loudnorm(stderr: &str) -> CoreResult<(f64, f64)> {
    let start = stderr
        .rfind('{')
        .ok_or_else(|| crate::error::CoreError::Ffmpeg("loudnorm produced no report".into()))?;
    let end = stderr[start..]
        .rfind('}')
        .ok_or_else(|| crate::error::CoreError::Ffmpeg("loudnorm report is truncated".into()))?;

    let json: serde_json::Value = serde_json::from_str(&stderr[start..start + end + 1])?;
    let read = |key: &str| -> f64 {
        json.get(key)
            .and_then(|value| value.as_str())
            .and_then(|value| value.parse::<f64>().ok())
            .unwrap_or(0.0)
    };

    Ok((read("input_i"), read("input_tp")))
}

#[cfg(test)]
mod tests {
    use super::*;

    const REPORT: &str = r#"
[Parsed_loudnorm_0 @ 0x1] 
{
	"input_i" : "-23.50",
	"input_tp" : "-2.30",
	"input_lra" : "7.20",
	"output_i" : "-24.00"
}
"#;

    #[test]
    fn parses_the_loudnorm_report() {
        let (integrated, peak) = parse_loudnorm(REPORT).unwrap();
        assert!((integrated + 23.5).abs() < 1e-6);
        assert!((peak + 2.3).abs() < 1e-6);
    }

    #[test]
    fn reports_an_error_when_there_is_no_report() {
        assert!(parse_loudnorm("frame= 100 fps=25").is_err());
    }
}
