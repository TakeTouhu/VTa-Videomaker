//! GPU / hardware encoding (design doc section 58).
//!
//! The available encoders depend on the machine, so they are probed at runtime
//! rather than assumed, and a missing encoder falls back to software instead of
//! failing an export the user has already waited for.

use crate::ffmpeg::{ffmpeg_binary, run};
use serde::{Deserialize, Serialize};
use std::process::Command;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Acceleration {
    #[default]
    None,
    Auto,
    /// NVIDIA NVENC
    Nvenc,
    /// Intel Quick Sync
    Qsv,
    /// AMD AMF
    Amf,
    /// Apple VideoToolbox
    VideoToolbox,
}

/// Encoder name for a codec and acceleration, e.g. ("h264", Nvenc) -> h264_nvenc.
pub fn encoder_name(codec: &str, acceleration: Acceleration) -> String {
    let base = if codec == "h265" { "hevc" } else { "h264" };
    match acceleration {
        Acceleration::Nvenc => format!("{base}_nvenc"),
        Acceleration::Qsv => format!("{base}_qsv"),
        Acceleration::Amf => format!("{base}_amf"),
        Acceleration::VideoToolbox => format!("{base}_videotoolbox"),
        Acceleration::None | Acceleration::Auto => {
            if codec == "h265" {
                "libx265".to_string()
            } else {
                "libx264".to_string()
            }
        }
    }
}

/// Quality arguments differ per encoder family: software uses CRF-style rate
/// control, hardware encoders take a bitrate and their own preset names.
pub fn quality_args(acceleration: Acceleration, bitrate_kbps: u32) -> Vec<String> {
    match acceleration {
        Acceleration::Nvenc => vec![
            "-preset".into(),
            "p5".into(),
            "-rc".into(),
            "vbr".into(),
            "-b:v".into(),
            format!("{bitrate_kbps}k"),
        ],
        Acceleration::Qsv => vec![
            "-preset".into(),
            "medium".into(),
            "-b:v".into(),
            format!("{bitrate_kbps}k"),
        ],
        Acceleration::Amf => vec![
            "-quality".into(),
            "balanced".into(),
            "-b:v".into(),
            format!("{bitrate_kbps}k"),
        ],
        Acceleration::VideoToolbox => vec!["-b:v".into(), format!("{bitrate_kbps}k")],
        Acceleration::None | Acceleration::Auto => vec![
            "-preset".into(),
            "medium".into(),
            "-b:v".into(),
            format!("{bitrate_kbps}k"),
        ],
    }
}

/// Lists the hardware encoders this FFmpeg build actually offers.
pub fn available() -> Vec<Acceleration> {
    let Ok(output) = run(Command::new(ffmpeg_binary()).args(["-hide_banner", "-encoders"])) else {
        return Vec::new();
    };
    parse_encoders(&String::from_utf8_lossy(&output.stdout))
}

pub fn parse_encoders(listing: &str) -> Vec<Acceleration> {
    let mut found = Vec::new();
    let mut add = |acceleration: Acceleration| {
        if !found.contains(&acceleration) {
            found.push(acceleration);
        }
    };

    for line in listing.lines() {
        if line.contains("_nvenc") {
            add(Acceleration::Nvenc);
        }
        if line.contains("_qsv") {
            add(Acceleration::Qsv);
        }
        if line.contains("_amf") {
            add(Acceleration::Amf);
        }
        if line.contains("_videotoolbox") {
            add(Acceleration::VideoToolbox);
        }
    }
    found
}

/// Resolves `Auto` against what the machine offers, preferring the fastest.
///
/// A requested encoder that is not present falls back to software: an export
/// that runs slowly is better than one that refuses to start.
pub fn resolve(requested: Acceleration, available: &[Acceleration]) -> Acceleration {
    match requested {
        Acceleration::Auto => [
            Acceleration::Nvenc,
            Acceleration::VideoToolbox,
            Acceleration::Qsv,
            Acceleration::Amf,
        ]
        .into_iter()
        .find(|candidate| available.contains(candidate))
        .unwrap_or(Acceleration::None),
        Acceleration::None => Acceleration::None,
        other => {
            if available.contains(&other) {
                other
            } else {
                Acceleration::None
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const LISTING: &str = "\
 V....D h264                 H.264
 V....D h264_nvenc           NVIDIA NVENC H.264 encoder
 V....D hevc_nvenc           NVIDIA NVENC hevc encoder
 V....D h264_qsv             H.264 (Intel Quick Sync Video)
";

    #[test]
    fn detects_the_encoders_the_build_offers() {
        let found = parse_encoders(LISTING);
        assert!(found.contains(&Acceleration::Nvenc));
        assert!(found.contains(&Acceleration::Qsv));
        assert!(!found.contains(&Acceleration::Amf));
    }

    #[test]
    fn reports_nothing_for_a_software_only_build() {
        assert!(parse_encoders(" V....D libx264 H.264").is_empty());
    }

    #[test]
    fn maps_codec_and_acceleration_onto_encoder_names() {
        assert_eq!(encoder_name("h264", Acceleration::Nvenc), "h264_nvenc");
        assert_eq!(encoder_name("h265", Acceleration::Nvenc), "hevc_nvenc");
        assert_eq!(encoder_name("h265", Acceleration::None), "libx265");
        assert_eq!(
            encoder_name("h264", Acceleration::VideoToolbox),
            "h264_videotoolbox"
        );
    }

    #[test]
    fn auto_picks_the_fastest_available() {
        let available = vec![Acceleration::Qsv, Acceleration::Nvenc];
        assert_eq!(resolve(Acceleration::Auto, &available), Acceleration::Nvenc);
    }

    #[test]
    fn auto_falls_back_to_software_when_nothing_is_available() {
        assert_eq!(resolve(Acceleration::Auto, &[]), Acceleration::None);
    }

    #[test]
    fn a_missing_requested_encoder_falls_back_rather_than_failing() {
        assert_eq!(
            resolve(Acceleration::Nvenc, &[Acceleration::Qsv]),
            Acceleration::None
        );
    }

    #[test]
    fn an_available_requested_encoder_is_kept() {
        assert_eq!(
            resolve(Acceleration::Qsv, &[Acceleration::Qsv]),
            Acceleration::Qsv
        );
    }

    #[test]
    fn hardware_quality_arguments_use_the_encoders_own_presets() {
        let nvenc = quality_args(Acceleration::Nvenc, 20_000);
        assert!(nvenc.contains(&"p5".to_string()));
        assert!(nvenc.contains(&"20000k".to_string()));

        let software = quality_args(Acceleration::None, 8_000);
        assert!(software.contains(&"medium".to_string()));
    }
}
