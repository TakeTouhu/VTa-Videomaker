//! FFmpeg / ffprobe control. The only place in the codebase that builds a
//! command line (design rule 5).

pub mod audio;
pub mod filters;
pub mod probe;
pub mod proxy;
pub mod thumbnail;
pub mod waveform;

use crate::error::{CoreError, CoreResult};
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::sync::OnceLock;

/// Directory holding the binaries shipped with the app, when there are any.
///
/// The shell resolves this at startup, because only it knows where the
/// platform puts bundled resources: next to the executable on Windows, but
/// inside the app bundle on macOS and under /usr/lib on Linux.
static BUNDLED_DIR: OnceLock<PathBuf> = OnceLock::new();

/// Registers the bundled binary directory. Ignored if called more than once.
pub fn set_bundled_dir(directory: impl AsRef<Path>) {
    let _ = BUNDLED_DIR.set(directory.as_ref().to_path_buf());
}

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

    // A binary shipped with the app wins, so the version the app was tested
    // against is the one that runs.
    if let Some(directory) = BUNDLED_DIR.get() {
        let bundled = directory.join(&executable);
        if bundled.exists() {
            return bundled;
        }
    }

    // Next to the executable, which is where a portable build keeps it.
    if let Ok(current) = std::env::current_exe() {
        if let Some(dir) = current.parent() {
            let bundled = dir.join("bin").join(&executable);
            if bundled.exists() {
                return bundled;
            }
        }
    }

    // Finally, whatever is on PATH.
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
    fn falls_back_to_path_when_nothing_is_bundled() {
        // No bundled directory is registered in tests, and the executable is
        // the test harness, so the lookup degrades to a bare command name.
        let resolved = binary_named("ffmpeg");
        assert_eq!(resolved.components().count(), 1);
    }

    #[test]
    fn uses_the_platform_executable_suffix() {
        let resolved = binary_named("ffprobe");
        let name = resolved.file_name().unwrap().to_string_lossy().to_string();
        assert_eq!(
            name,
            if cfg!(windows) {
                "ffprobe.exe"
            } else {
                "ffprobe"
            }
        );
    }

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
