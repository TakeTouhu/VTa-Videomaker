//! Editing proxy generation (design doc section 34).
//!
//! Proxies are used for preview only; export always reads the original file.

use crate::error::CoreResult;
use crate::ffmpeg::{ffmpeg_binary, run};
use std::path::{Path, PathBuf};
use std::process::Command;

/// Long edge of the proxy. 960 keeps 4K editing responsive on a laptop GPU.
pub const PROXY_HEIGHT: u32 = 540;

pub fn generate(source: &Path, destination: &Path) -> CoreResult<PathBuf> {
    if let Some(parent) = destination.parent() {
        std::fs::create_dir_all(parent)?;
    }

    run(Command::new(ffmpeg_binary()).args([
        "-y",
        "-i",
        &source.display().to_string(),
        "-vf",
        &format!("scale=-2:{PROXY_HEIGHT}"),
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "26",
        // All-intra keeps scrubbing fast, which is the whole point of a proxy.
        "-g",
        "1",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        &destination.display().to_string(),
    ]))?;

    Ok(destination.to_path_buf())
}
