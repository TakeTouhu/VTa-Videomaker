//! Builds FFmpeg filter strings from clip parameters.
//!
//! The AI never produces these strings: it produces validated parameters, and
//! this module is the single place that turns parameters into a filter graph
//! (design doc sections 25 and 63).

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColorSettings {
    pub exposure: f64,
    pub contrast: f64,
    pub highlights: f64,
    pub shadows: f64,
    pub whites: f64,
    pub blacks: f64,
    pub temperature: f64,
    pub tint: f64,
    pub saturation: f64,
}

impl Default for ColorSettings {
    fn default() -> Self {
        Self {
            exposure: 0.0,
            contrast: 0.0,
            highlights: 0.0,
            shadows: 0.0,
            whites: 0.0,
            blacks: 0.0,
            temperature: 0.0,
            tint: 0.0,
            saturation: 100.0,
        }
    }
}

impl ColorSettings {
    pub fn is_default(&self) -> bool {
        let default = ColorSettings::default();
        (self.exposure - default.exposure).abs() < f64::EPSILON
            && (self.contrast - default.contrast).abs() < f64::EPSILON
            && (self.highlights - default.highlights).abs() < f64::EPSILON
            && (self.shadows - default.shadows).abs() < f64::EPSILON
            && (self.whites - default.whites).abs() < f64::EPSILON
            && (self.blacks - default.blacks).abs() < f64::EPSILON
            && (self.temperature - default.temperature).abs() < f64::EPSILON
            && (self.tint - default.tint).abs() < f64::EPSILON
            && (self.saturation - default.saturation).abs() < f64::EPSILON
    }
}

/// UI ranges are -100..100 (saturation 0..200); FFmpeg's eq filter wants
/// brightness -1..1, contrast 0..2 and saturation 0..3.
pub fn color_filter(color: &ColorSettings) -> Option<String> {
    if color.is_default() {
        return None;
    }

    let brightness = clamp(color.exposure / 100.0, -1.0, 1.0);
    let contrast = clamp(1.0 + color.contrast / 100.0, 0.0, 2.0);
    let saturation = clamp(color.saturation / 100.0, 0.0, 3.0);

    let mut filters = vec![format!(
        "eq=brightness={brightness:.4}:contrast={contrast:.4}:saturation={saturation:.4}"
    )];

    // Highlights / shadows / whites / blacks are a tone curve, not eq inputs.
    if let Some(curve) = tone_curve(color) {
        filters.push(curve);
    }
    if let Some(balance) = white_balance(color) {
        filters.push(balance);
    }

    Some(filters.join(","))
}

/// Maps shadow / highlight lift into a curves control point pair.
fn tone_curve(color: &ColorSettings) -> Option<String> {
    let any = [color.highlights, color.shadows, color.whites, color.blacks]
        .iter()
        .any(|value| value.abs() > f64::EPSILON);
    if !any {
        return None;
    }

    let black = clamp(color.blacks / 400.0, -0.25, 0.25);
    let shadow = clamp(0.25 + color.shadows / 400.0, 0.0, 1.0);
    let highlight = clamp(0.75 + color.highlights / 400.0, 0.0, 1.0);
    let white = clamp(1.0 + color.whites / 400.0, 0.0, 1.0);

    Some(format!(
        "curves=all='0/{:.4} 0.25/{:.4} 0.75/{:.4} 1/{:.4}'",
        black.max(0.0),
        shadow,
        highlight,
        white
    ))
}

/// Temperature / tint as per-channel gain via the colorbalance filter.
fn white_balance(color: &ColorSettings) -> Option<String> {
    if color.temperature.abs() < f64::EPSILON && color.tint.abs() < f64::EPSILON {
        return None;
    }
    let warm = clamp(color.temperature / 200.0, -0.5, 0.5);
    let tint = clamp(color.tint / 200.0, -0.5, 0.5);
    Some(format!(
        "colorbalance=rm={warm:.4}:gm={tint:.4}:bm={:.4}",
        -warm
    ))
}

/// Volume in dB plus optional fades (design doc section 14).
pub fn audio_filter(volume_db: f64, fade_in: f64, fade_out: f64, duration: f64) -> String {
    let mut filters = vec![format!("volume={volume_db:.2}dB")];
    if fade_in > 0.0 {
        filters.push(format!("afade=t=in:st=0:d={fade_in:.3}"));
    }
    if fade_out > 0.0 && duration > fade_out {
        filters.push(format!(
            "afade=t=out:st={:.3}:d={fade_out:.3}",
            duration - fade_out
        ));
    }
    filters.join(",")
}

/// Speed change: setpts for video, atempo (chained, since one stage only covers
/// 0.5x-2x) for audio.
pub fn speed_filters(speed: f64) -> (String, String) {
    let speed = speed.clamp(0.1, 10.0);
    let video = format!("setpts={:.6}*PTS", 1.0 / speed);

    let mut remaining = speed;
    let mut stages = Vec::new();
    while remaining > 2.0 {
        stages.push("atempo=2.0".to_string());
        remaining /= 2.0;
    }
    while remaining < 0.5 {
        stages.push("atempo=0.5".to_string());
        remaining /= 0.5;
    }
    stages.push(format!("atempo={remaining:.6}"));

    (video, stages.join(","))
}

fn clamp(value: f64, min: f64, max: f64) -> f64 {
    value.max(min).min(max)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_color_produces_no_filter() {
        assert!(color_filter(&ColorSettings::default()).is_none());
    }

    #[test]
    fn exposure_maps_into_eq_brightness() {
        let color = ColorSettings {
            exposure: 50.0,
            ..Default::default()
        };
        let filter = color_filter(&color).unwrap();
        assert!(filter.contains("brightness=0.5000"), "{filter}");
    }

    #[test]
    fn saturation_is_normalised_to_ffmpeg_range() {
        let color = ColorSettings {
            saturation: 150.0,
            ..Default::default()
        };
        let filter = color_filter(&color).unwrap();
        assert!(filter.contains("saturation=1.5000"), "{filter}");
    }

    #[test]
    fn out_of_range_values_are_clamped() {
        let color = ColorSettings {
            exposure: 100_000.0,
            contrast: 100_000.0,
            ..Default::default()
        };
        let filter = color_filter(&color).unwrap();
        assert!(filter.contains("brightness=1.0000"), "{filter}");
        assert!(filter.contains("contrast=2.0000"), "{filter}");
    }

    #[test]
    fn fast_speed_chains_atempo_stages() {
        let (video, audio) = speed_filters(4.0);
        assert_eq!(video, "setpts=0.250000*PTS");
        assert_eq!(audio.matches("atempo").count(), 2);
    }

    #[test]
    fn fade_out_is_placed_at_the_end() {
        let filter = audio_filter(0.0, 0.0, 1.0, 10.0);
        assert!(filter.contains("afade=t=out:st=9.000"), "{filter}");
    }

    #[test]
    fn fade_out_longer_than_clip_is_dropped() {
        let filter = audio_filter(0.0, 0.0, 20.0, 10.0);
        assert!(!filter.contains("t=out"), "{filter}");
    }
}
