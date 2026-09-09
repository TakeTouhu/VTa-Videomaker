//! Thumbnail extraction into the media cache.

use crate::error::CoreResult;
use crate::ffmpeg::{ffmpeg_binary, run};
use std::path::{Path, PathBuf};
use std::process::Command;

pub fn generate(source: &Path, destination: &Path, at_seconds: f64) -> CoreResult<PathBuf> {
    if let Some(parent) = destination.parent() {
        std::fs::create_dir_all(parent)?;
    }

    run(Command::new(ffmpeg_binary()).args([
        "-y",
        "-ss",
        &format!("{at_seconds:.3}"),
        "-i",
        &source.display().to_string(),
        "-frames:v",
        "1",
        "-vf",
        "scale=320:-2",
        "-q:v",
        "4",
        &destination.display().to_string(),
    ]))?;

    Ok(destination.to_path_buf())
}
