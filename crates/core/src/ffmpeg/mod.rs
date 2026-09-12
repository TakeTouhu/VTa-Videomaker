//! FFmpeg / ffprobe control. The only place in the codebase that builds a
//! command line (design rule 5).

pub mod filters;
pub mod probe;
pub mod proxy;
pub mod thumbnail;
pub mod waveform;

use crate::error::{CoreError, CoreResult};
use std::path::PathBuf;
use std::process::{Command, Output};

/// Resolves the ffmpeg binary. A bundled binary next to the executable wins so
/// the app does not depend on the user's PATH.
pub fn ffmpeg_binary() -> PathBuf {
    binary_named("ffmpeg")
}

pub fn ffprobe_binary() -> PathBuf {
    binary_named("ffprobe")
}

fn binary_named(name: &str) -> PathBuf {
    let executable = if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    };

    if let Ok(current) = std::env::current_exe() {
        if let Some(dir) = current.parent() {
            let bundled = dir.join("bin").join(&executable);
            if bundled.exists() {
                return bundled;
            }
        }
    }
    PathBuf::from(executable)
}

/// Runs a command to completion, mapping a non-zero exit into a typed error.
pub fn run(command: &mut Command) -> CoreResult<Output> {
    #[cfg(windows)]
    {
        // Keep console windows from flashing up during background jobs.
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let output = command.output().map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            CoreError::FfmpegMissing
        } else {
            CoreError::Io(error)
        }
    })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(classify_ffmpeg_error(&stderr));
    }
    Ok(output)
}

/// Turns FFmpeg's stderr into the closest typed error we can report.
pub fn classify_ffmpeg_error(stderr: &str) -> CoreError {
    let lower = stderr.to_lowercase();
    if lower.contains("no such file") || lower.contains("does not exist") {
        CoreError::FileNotFound(first_line(stderr))
    } else if lower.contains("no space left") {
        CoreError::DiskFull
    } else if lower.contains("unknown encoder") || lower.contains("decoder not found") {
        CoreError::CodecUnsupported(first_line(stderr))
    } else if lower.contains("invalid data found") || lower.contains("moov atom not found") {
        CoreError::MediaCorrupt(first_line(stderr))
    } else {
        CoreError::Ffmpeg(first_line(stderr))
    }
}

fn first_line(text: &str) -> String {
    text.lines()
        .rev()
        .find(|line| !line.trim().is_empty())
        .unwrap_or("unknown ffmpeg error")
        .trim()
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_missing_file() {
        let error = classify_ffmpeg_error("input.mp4: No such file or directory");
        assert!(matches!(error, CoreError::FileNotFound(_)));
    }

    #[test]
    fn classifies_disk_full() {
        let error = classify_ffmpeg_error("av_interleaved_write_frame(): No space left on device");
        assert!(matches!(error, CoreError::DiskFull));
    }

    #[test]
    fn classifies_corrupt_media() {
        let error = classify_ffmpeg_error("moov atom not found");
        assert!(matches!(error, CoreError::MediaCorrupt(_)));
    }
}
