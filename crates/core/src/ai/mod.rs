//! AI analysis pipeline (design doc sections 20, 46, 70).
//!
//! Phase 3 plugs a speech-to-text provider in behind `analyze`. Silence
//! detection is already implemented here because it needs no model at all:
//! it reads FFmpeg's silencedetect output.

pub mod scene;
pub mod silence;
pub mod transcribe;

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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaAnalysis {
    pub media_id: String,
    pub transcript: Vec<TranscriptSegment>,
    pub silences: Vec<SilenceRange>,
    pub scenes: Vec<f64>,
    pub analyzed_at: String,
}
