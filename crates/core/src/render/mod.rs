//! Render engine: turns a sequence into an FFmpeg filter graph and runs it.

pub mod captions;
pub mod effects;
pub mod graph;
pub mod hardware;
pub mod progress;

use crate::error::{CoreError, CoreResult};
use crate::ffmpeg::{classify_ffmpeg_error, ffmpeg_binary};
use crate::timeline::Sequence;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportSettings {
    pub output_path: String,
    pub format: String,
    pub codec: String,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub quality: String,
    #[serde(default)]
    pub bitrate_kbps: Option<u32>,
    pub audio_bitrate_kbps: u32,
    /// GPU encoder selection (design doc section 58).
    #[serde(default)]
    pub hardware_acceleration: hardware::Acceleration,
}

impl ExportSettings {
    /// Video bitrate in kbps for the selected quality preset.
    pub fn video_bitrate(&self) -> u32 {
        match self.quality.as_str() {
            "low" => 4_000,
            "medium" => 10_000,
            "high" => 20_000,
            _ => self.bitrate_kbps.unwrap_or(12_000),
        }
    }

    /// Encoder name for the resolved acceleration.
    pub fn encoder_for(&self, acceleration: hardware::Acceleration) -> String {
        hardware::encoder_name(&self.codec, acceleration)
    }

    /// Software encoder name, used when no acceleration is in play.
    pub fn encoder(&self) -> &'static str {
        match self.codec.as_str() {
            "h265" => "libx265",
            _ => "libx264",
        }
    }
}

/// Runs an export, reporting progress through the callback.
///
/// `media_paths` maps media ids to absolute source paths; export always reads
/// the original file, never the proxy (design doc section 34).
pub fn export(
    sequence: &Sequence,
    settings: &ExportSettings,
    media_paths: &HashMap<String, PathBuf>,
    cancel: Arc<AtomicBool>,
    mut on_progress: impl FnMut(f64),
) -> CoreResult<PathBuf> {
    let total = sequence.duration();
    if total <= 0.0 {
        return Err(CoreError::Render("sequence is empty".into()));
    }

    let plan = graph::build(sequence, settings, media_paths)?;

    let mut child = Command::new(ffmpeg_binary())
        .args(&plan.args)
        .stderr(Stdio::piped())
        .stdout(Stdio::null())
        .spawn()
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                CoreError::FfmpegMissing
            } else {
                CoreError::Io(error)
            }
        })?;

    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| CoreError::Render("could not capture ffmpeg output".into()))?;

    let mut tail = String::new();
    for line in BufReader::new(stderr).lines() {
        let line = line.unwrap_or_default();

        if cancel.load(Ordering::Relaxed) {
            let _ = child.kill();
            return Err(CoreError::Render("cancelled".into()));
        }
        if let Some(seconds) = progress::parse_time(&line) {
            on_progress((seconds / total).clamp(0.0, 1.0));
        }
        // Keep only the last lines: that is where ffmpeg reports the failure.
        tail.push_str(&line);
        tail.push('\n');
        if tail.len() > 8_192 {
            tail = tail.split_off(tail.len() - 4_096);
        }
    }

    let status = child.wait()?;
    if !status.success() {
        return Err(classify_ffmpeg_error(&tail));
    }

    on_progress(1.0);
    Ok(PathBuf::from(&settings.output_path))
}
