//! Rust-side mirror of the timeline model.
//!
//! The engine that edits a sequence lives in TypeScript; this module only needs
//! to read a sequence in order to render it, so it mirrors the data model and
//! the few derived values the renderer needs.

use crate::ffmpeg::filters::ColorSettings;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Transform {
    pub position_x: f64,
    pub position_y: f64,
    pub scale: f64,
    pub rotation: f64,
    pub opacity: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioSettings {
    pub volume: f64,
    pub pan: f64,
    pub fade_in: f64,
    pub fade_out: f64,
    pub muted: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct MaskPoint {
    pub x: f64,
    pub y: f64,
}

/// Mask geometry in normalised 0..1 frame coordinates (design doc section 17).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum MaskShape {
    #[serde(rename_all = "camelCase")]
    Rectangle {
        x: f64,
        y: f64,
        width: f64,
        height: f64,
        #[serde(default)]
        rotation: f64,
        #[serde(default)]
        corner_radius: f64,
    },
    #[serde(rename_all = "camelCase")]
    Ellipse {
        x: f64,
        y: f64,
        radius_x: f64,
        radius_y: f64,
        #[serde(default)]
        rotation: f64,
    },
    #[serde(rename_all = "camelCase")]
    Polygon { points: Vec<MaskPoint> },
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackSample {
    pub time: f64,
    pub offset_x: f64,
    pub offset_y: f64,
    pub scale: f64,
    pub confidence: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Mask {
    pub id: String,
    #[serde(default)]
    pub name: String,
    pub shape: MaskShape,
    #[serde(default)]
    pub feather: f64,
    #[serde(default)]
    pub expansion: f64,
    #[serde(default = "one")]
    pub opacity: f64,
    #[serde(default)]
    pub inverted: bool,
    #[serde(default = "yes")]
    pub enabled: bool,
    #[serde(default)]
    pub track: Vec<TrackSample>,
}

fn one() -> f64 {
    1.0
}

fn yes() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Effect {
    pub id: String,
    #[serde(rename = "type")]
    pub effect_type: String,
    #[serde(default = "yes")]
    pub enabled: bool,
    #[serde(default)]
    pub parameters: serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Keyframe {
    pub time: f64,
    pub value: f64,
    #[serde(default)]
    pub interpolation: Interpolation,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum Interpolation {
    #[default]
    Linear,
    Hold,
    Ease,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyframeTrack {
    pub property: String,
    #[serde(default)]
    pub keyframes: Vec<Keyframe>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextSettings {
    pub content: String,
    #[serde(default)]
    pub font_family: String,
    pub font_size: u32,
    pub color: String,
    #[serde(default)]
    pub background_color: String,
    #[serde(default)]
    pub outline_color: String,
    #[serde(default)]
    pub outline_width: u32,
    #[serde(default)]
    pub bold: bool,
    pub x: f64,
    pub y: f64,
    #[serde(default)]
    pub alignment: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Transition {
    pub id: String,
    pub track_id: String,
    pub from_clip_id: String,
    pub to_clip_id: String,
    #[serde(rename = "type")]
    pub transition_type: String,
    pub duration: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Clip {
    pub id: String,
    pub media_id: Option<String>,
    pub track_id: String,
    pub kind: String,
    pub start_time: f64,
    pub source_in: f64,
    pub source_out: f64,
    pub speed: f64,
    pub transform: Transform,
    pub color: ColorSettings,
    #[serde(default)]
    pub audio: Option<AudioSettings>,
    #[serde(default)]
    pub masks: Vec<Mask>,
    #[serde(default)]
    pub effects: Vec<Effect>,
    #[serde(default)]
    pub keyframes: Vec<KeyframeTrack>,
    #[serde(default)]
    pub text: Option<TextSettings>,
}

impl Clip {
    pub fn is_adjustment(&self) -> bool {
        self.kind == "adjustment"
    }

    pub fn is_text(&self) -> bool {
        self.kind == "text"
    }

    /// Timeline duration: the source range compressed by the speed factor.
    pub fn duration(&self) -> f64 {
        let source = (self.source_out - self.source_in).max(0.0);
        let speed = if self.speed > 0.0 { self.speed } else { 1.0 };
        source / speed
    }

    pub fn end_time(&self) -> f64 {
        self.start_time + self.duration()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoTrack {
    pub id: String,
    pub name: String,
    pub locked: bool,
    pub hidden: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioTrack {
    pub id: String,
    pub name: String,
    pub locked: bool,
    pub muted: bool,
    pub solo: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptionCue {
    pub id: String,
    pub start: f64,
    pub end: f64,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptionStyle {
    pub font_family: String,
    pub font_size: u32,
    pub color: String,
    pub background_color: String,
    pub outline_color: String,
    pub outline_width: u32,
    /// 0..1 from the top of the frame.
    pub position_y: f64,
    pub alignment: String,
    #[serde(default)]
    pub bold: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptionTrack {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub style: CaptionStyle,
    pub cues: Vec<CaptionCue>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Sequence {
    pub id: String,
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub video_tracks: Vec<VideoTrack>,
    pub audio_tracks: Vec<AudioTrack>,
    pub clips: Vec<Clip>,
    #[serde(default)]
    pub caption_tracks: Vec<CaptionTrack>,
    #[serde(default)]
    pub transitions: Vec<Transition>,
    #[serde(default)]
    pub playhead: f64,
}

impl Sequence {
    pub fn duration(&self) -> f64 {
        self.clips
            .iter()
            .map(Clip::end_time)
            .fold(0.0, |max, end| if end > max { end } else { max })
    }

    /// Video tracks bottom to top, i.e. compositing order.
    pub fn visible_video_tracks(&self) -> impl Iterator<Item = &VideoTrack> {
        self.video_tracks.iter().filter(|track| !track.hidden)
    }

    /// Audio tracks that contribute to the mix, honouring solo.
    pub fn audible_audio_tracks(&self) -> Vec<&AudioTrack> {
        let has_solo = self.audio_tracks.iter().any(|track| track.solo);
        self.audio_tracks
            .iter()
            .filter(|track| if has_solo { track.solo } else { !track.muted })
            .collect()
    }

    /// Adjustment layers on visible tracks, ordered bottom track first so they
    /// apply in compositing order (design doc section 16).
    pub fn adjustment_layers(&self) -> Vec<&Clip> {
        let order: std::collections::HashMap<&str, usize> = self
            .video_tracks
            .iter()
            .enumerate()
            .map(|(index, track)| (track.id.as_str(), index))
            .collect();

        let mut layers: Vec<&Clip> = self
            .clips
            .iter()
            .filter(|clip| {
                clip.is_adjustment()
                    && self
                        .video_tracks
                        .iter()
                        .any(|track| track.id == clip.track_id && !track.hidden)
            })
            .collect();

        layers.sort_by_key(|clip| order.get(clip.track_id.as_str()).copied().unwrap_or(0));
        layers
    }

    /// Video tracks that carry ordinary media, bottom to top. Adjustment layers
    /// are applied on top of the composite rather than being composited.
    pub fn media_video_track_ids(&self) -> Vec<&str> {
        self.video_tracks
            .iter()
            .filter(|track| !track.hidden)
            .map(|track| track.id.as_str())
            .collect()
    }

    pub fn clips_on_track(&self, track_id: &str) -> Vec<&Clip> {
        let mut clips: Vec<&Clip> = self
            .clips
            .iter()
            .filter(|clip| clip.track_id == track_id)
            .collect();
        clips.sort_by(|a, b| a.start_time.total_cmp(&b.start_time));
        clips
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn clip(id: &str, start: f64, source_in: f64, source_out: f64, speed: f64) -> Clip {
        Clip {
            id: id.into(),
            media_id: Some("m1".into()),
            track_id: "v1".into(),
            kind: "media".into(),
            start_time: start,
            source_in,
            source_out,
            speed,
            transform: Transform {
                position_x: 0.0,
                position_y: 0.0,
                scale: 100.0,
                rotation: 0.0,
                opacity: 100.0,
            },
            color: ColorSettings::default(),
            audio: None,
            masks: vec![],
            effects: vec![],
            keyframes: vec![],
            text: None,
        }
    }

    #[test]
    fn duration_accounts_for_speed() {
        assert_eq!(clip("a", 0.0, 0.0, 10.0, 2.0).duration(), 5.0);
        assert_eq!(clip("a", 0.0, 0.0, 10.0, 0.5).duration(), 20.0);
    }

    #[test]
    fn zero_speed_falls_back_to_realtime() {
        assert_eq!(clip("a", 0.0, 0.0, 10.0, 0.0).duration(), 10.0);
    }

    #[test]
    fn sequence_duration_is_the_last_clip_end() {
        let sequence = Sequence {
            id: "s".into(),
            name: "s".into(),
            width: 1920,
            height: 1080,
            fps: 30.0,
            video_tracks: vec![],
            audio_tracks: vec![],
            clips: vec![
                clip("a", 0.0, 0.0, 5.0, 1.0),
                clip("b", 10.0, 0.0, 2.0, 1.0),
            ],
            caption_tracks: vec![],
            transitions: vec![],
            playhead: 0.0,
        };
        assert_eq!(sequence.duration(), 12.0);
    }

    #[test]
    fn solo_track_silences_the_others() {
        let sequence = Sequence {
            id: "s".into(),
            name: "s".into(),
            width: 1920,
            height: 1080,
            fps: 30.0,
            video_tracks: vec![],
            audio_tracks: vec![
                AudioTrack {
                    id: "a1".into(),
                    name: "A1".into(),
                    locked: false,
                    muted: false,
                    solo: false,
                },
                AudioTrack {
                    id: "a2".into(),
                    name: "A2".into(),
                    locked: false,
                    muted: false,
                    solo: true,
                },
            ],
            clips: vec![],
            caption_tracks: vec![],
            transitions: vec![],
            playhead: 0.0,
        };
        let audible = sequence.audible_audio_tracks();
        assert_eq!(audible.len(), 1);
        assert_eq!(audible[0].id, "a2");
    }
}
