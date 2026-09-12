//! Frame and loudness statistics used by AI colour and audio correction
//! (design doc section 57).
//!
//! These need no model: FFmpeg's signalstats and loudnorm filters measure the
//! footage, and the corrections are derived from the measurements. The result
//! is a set of ordinary editing parameters the user can adjust afterwards.

use crate::error::{CoreError, CoreResult};
use crate::ffmpeg::{ffmpeg_binary, run};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Command;

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameStats {
    /// Average luma, 0..255.
    pub luma_average: f64,
    /// Luma at the low and high ends of the range, 0..255.
    pub luma_low: f64,
    pub luma_high: f64,
    /// Average chroma deviation from neutral; higher means more saturated.
    pub saturation: f64,
    /// Positive means the image leans blue, negative means it leans orange.
    pub blue_bias: f64,
}

/// Measures the footage with signalstats over a sampled set of frames.
pub fn measure_video(path: &Path, sample_fps: f64) -> CoreResult<FrameStats> {
    let output = run(Command::new(ffmpeg_binary()).args([
        "-i",
        &path.display().to_string(),
        "-vf",
        &format!("fps={sample_fps},signalstats,metadata=print:file=-"),
        "-an",
        "-f",
        "null",
        "-",
    ]))?;

    let text = String::from_utf8_lossy(&output.stdout);
    let stats = parse_signalstats(&text);
    if stats.is_none() {
        let fallback = String::from_utf8_lossy(&output.stderr);
        return parse_signalstats(&fallback)
            .ok_or_else(|| CoreError::Ffmpeg("signalstats produced no output".into()));
    }
    Ok(stats.unwrap_or_default())
}

/// Averages the per-frame `lavfi.signalstats.*` values FFmpeg prints.
pub fn parse_signalstats(output: &str) -> Option<FrameStats> {
    let mut sums = [0.0f64; 5];
    let mut counts = [0usize; 5];

    for line in output.lines() {
        let Some((key, value)) = line.trim().split_once('=') else {
            continue;
        };
        let Ok(value) = value.trim().parse::<f64>() else {
            continue;
        };
        let index = match key.trim() {
            "lavfi.signalstats.YAVG" => 0,
            "lavfi.signalstats.YLOW" => 1,
            "lavfi.signalstats.YHIGH" => 2,
            "lavfi.signalstats.SATAVG" => 3,
            "lavfi.signalstats.UAVG" => 4,
            _ => continue,
        };
        sums[index] += value;
        counts[index] += 1;
    }

    if counts[0] == 0 {
        return None;
    }
    let average = |index: usize| {
        if counts[index] == 0 {
            0.0
        } else {
            sums[index] / counts[index] as f64
        }
    };

    Some(FrameStats {
        luma_average: average(0),
        luma_low: average(1),
        luma_high: average(2),
        saturation: average(3),
        // U is the blue-difference channel, neutral at 128.
        blue_bias: average(4) - 128.0,
    })
}

/// Colour correction derived from the measurements, in UI parameter space.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ColorCorrection {
    pub exposure: f64,
    pub contrast: f64,
    pub saturation: f64,
    pub temperature: f64,
}

/// Target mid-grey. 110 of 255 is a natural-looking average for graded footage.
pub const TARGET_LUMA: f64 = 110.0;
/// Target spread between the low and high ends of the luma range.
pub const TARGET_RANGE: f64 = 150.0;
/// Target average chroma saturation from signalstats.
pub const TARGET_SATURATION: f64 = 70.0;

/// Suggests a conservative correction. Every value is clamped so a single bad
/// measurement cannot produce a wild grade.
pub fn suggest_correction(stats: &FrameStats) -> ColorCorrection {
    let exposure = clamp(
        ((TARGET_LUMA - stats.luma_average) / 255.0) * 200.0,
        -40.0,
        40.0,
    );

    let range = (stats.luma_high - stats.luma_low).max(1.0);
    let contrast = clamp(((TARGET_RANGE - range) / TARGET_RANGE) * 60.0, -30.0, 30.0);

    let saturation = if stats.saturation <= 0.0 {
        100.0
    } else {
        clamp((TARGET_SATURATION / stats.saturation) * 100.0, 70.0, 140.0)
    };

    // A blue cast is corrected by warming the image, and vice versa.
    let temperature = clamp(stats.blue_bias * 1.5, -30.0, 30.0);

    ColorCorrection {
        exposure,
        contrast,
        saturation,
        temperature,
    }
}

/// Gain needed to bring the measured loudness onto the broadcast target.
///
/// Clamped so a quiet clip is not boosted into clipping; the true peak caps it.
pub fn suggest_gain(integrated_lufs: f64, true_peak_db: f64, target_lufs: f64) -> f64 {
    let wanted = target_lufs - integrated_lufs;
    // Leave 1 dB of headroom below 0 dBTP.
    let headroom = -1.0 - true_peak_db;
    clamp(wanted.min(headroom), -12.0, 12.0)
}

fn clamp(value: f64, min: f64, max: f64) -> f64 {
    value.max(min).min(max)
}

#[cfg(test)]
mod tests {
    use super::*;

    const STATS: &str = "\
frame:0 pts:0 pts_time:0
lavfi.signalstats.YAVG=60.0
lavfi.signalstats.YLOW=16.0
lavfi.signalstats.YHIGH=180.0
lavfi.signalstats.SATAVG=40.0
lavfi.signalstats.UAVG=140.0
frame:1 pts:1 pts_time:1
lavfi.signalstats.YAVG=80.0
lavfi.signalstats.YLOW=20.0
lavfi.signalstats.YHIGH=200.0
lavfi.signalstats.SATAVG=50.0
lavfi.signalstats.UAVG=136.0
";

    #[test]
    fn averages_the_sampled_frames() {
        let stats = parse_signalstats(STATS).unwrap();
        assert!((stats.luma_average - 70.0).abs() < 1e-6);
        assert!((stats.luma_low - 18.0).abs() < 1e-6);
        assert!((stats.saturation - 45.0).abs() < 1e-6);
    }

    #[test]
    fn reports_a_blue_cast_as_a_positive_bias() {
        let stats = parse_signalstats(STATS).unwrap();
        assert!(stats.blue_bias > 0.0);
    }

    #[test]
    fn returns_nothing_when_there_are_no_measurements() {
        assert!(parse_signalstats("frame= 100 fps=25").is_none());
    }

    #[test]
    fn brightens_dark_footage() {
        let correction = suggest_correction(&FrameStats {
            luma_average: 40.0,
            luma_low: 10.0,
            luma_high: 120.0,
            saturation: 70.0,
            blue_bias: 0.0,
        });
        assert!(correction.exposure > 0.0);
    }

    #[test]
    fn darkens_blown_out_footage() {
        let correction = suggest_correction(&FrameStats {
            luma_average: 200.0,
            luma_low: 100.0,
            luma_high: 255.0,
            saturation: 70.0,
            blue_bias: 0.0,
        });
        assert!(correction.exposure < 0.0);
    }

    #[test]
    fn adds_contrast_to_flat_footage() {
        let correction = suggest_correction(&FrameStats {
            luma_average: 110.0,
            luma_low: 90.0,
            luma_high: 130.0,
            saturation: 70.0,
            blue_bias: 0.0,
        });
        assert!(correction.contrast > 0.0);
    }

    #[test]
    fn warms_a_blue_cast() {
        let correction = suggest_correction(&FrameStats {
            blue_bias: 10.0,
            ..Default::default()
        });
        assert!(correction.temperature > 0.0);
    }

    #[test]
    fn corrections_stay_within_safe_bounds() {
        let correction = suggest_correction(&FrameStats {
            luma_average: 0.0,
            luma_low: 0.0,
            luma_high: 0.0,
            saturation: 0.01,
            blue_bias: 1000.0,
        });
        assert!(correction.exposure <= 40.0);
        assert!(correction.temperature <= 30.0);
        assert!(correction.saturation <= 140.0);
    }

    #[test]
    fn a_neutral_image_needs_no_saturation_change() {
        let correction = suggest_correction(&FrameStats {
            luma_average: TARGET_LUMA,
            luma_low: 20.0,
            luma_high: 170.0,
            saturation: TARGET_SATURATION,
            blue_bias: 0.0,
        });
        assert!((correction.saturation - 100.0).abs() < 1e-6);
    }

    #[test]
    fn raises_a_quiet_clip_towards_the_target() {
        let gain = suggest_gain(-30.0, -12.0, -16.0);
        assert!((gain - 11.0).abs() < 1e-6);
    }

    #[test]
    fn never_pushes_a_clip_into_clipping() {
        // Already peaking: the headroom rule wins over the loudness target.
        let gain = suggest_gain(-30.0, -0.5, -16.0);
        assert!(gain < 0.0);
    }

    #[test]
    fn lowers_an_over_loud_clip() {
        assert!(suggest_gain(-8.0, -3.0, -16.0) < 0.0);
    }
}
