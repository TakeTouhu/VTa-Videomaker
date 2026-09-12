//! AI analysis pipeline (design doc sections 20, 46, 70).
//!
//! Phase 3 plugs a speech-to-text provider in behind `analyze`. Silence
//! detection is already implemented here because it needs no model at all:
//! it reads FFmpeg's silencedetect output.

pub mod scene;
pub mod silence;
pub mod stats;
pub mod transcribe;
pub mod vision;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptSegment {
    pub start: f64,
    pub end: f64,
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub confidence: Option<f64>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SilenceRange {
    pub start: f64,
    pub end: f64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaAnalysis {
    pub media_id: String,
    pub transcript: Vec<TranscriptSegment>,
    pub silences: Vec<SilenceRange>,
    pub scenes: Vec<f64>,
    /// Per-frame detections, when a detector is configured (section 57).
    #[serde(default)]
    pub detections: Vec<vision::FrameDetections>,
    /// Short descriptions of sampled frames, from a vision model (section 47).
    #[serde(default)]
    pub descriptions: Vec<SceneDescription>,
    /// Measured picture statistics, driving AI colour correction.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub frame_stats: Option<stats::FrameStats>,
    /// Integrated loudness (LUFS) and true peak (dBTP).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub loudness: Option<Loudness>,
    pub analyzed_at: String,
}

/// A natural language description of what is on screen at a point in time.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneDescription {
    pub time: f64,
    pub text: String,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Loudness {
    pub integrated_lufs: f64,
    pub true_peak_db: f64,
}
