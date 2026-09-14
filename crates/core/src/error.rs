//! Error taxonomy shared with the UI (design doc section 49).
//!
//! Every failure is classified so the front end can show a user-facing message
//! while the technical detail goes to the log instead of the screen.

use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum CoreError {
    #[error("file not found: {0}")]
    FileNotFound(String),

    #[error("media is corrupt or unreadable: {0}")]
    MediaCorrupt(String),

    #[error("unsupported codec: {0}")]
    CodecUnsupported(String),

    #[error("ffmpeg failed: {0}")]
    Ffmpeg(String),

    #[error("ffmpeg or ffprobe was not found on PATH")]
    FfmpegMissing,

    #[error("not enough disk space")]
    DiskFull,

    #[error("render failed: {0}")]
    Render(String),

    #[error("project could not be loaded: {0}")]
    ProjectLoad(String),

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("serialization error: {0}")]
    Serde(#[from] serde_json::Error),

    #[error("{0}")]
    Other(String),
}

/// Wire format: the UI switches on `kind` and shows its own localized message.
#[derive(Debug, Serialize)]
pub struct SerializedError {
    pub kind: &'static str,
    pub detail: String,
}

impl CoreError {
    pub fn to_serialized(&self) -> SerializedError {
        let kind = match self {
            CoreError::FileNotFound(_) => "file_not_found",
            CoreError::MediaCorrupt(_) => "media_corrupt",
            CoreError::CodecUnsupported(_) => "codec_unsupported",
            CoreError::Ffmpeg(_) | CoreError::FfmpegMissing => "ffmpeg_failed",
            CoreError::DiskFull => "disk_full",
            CoreError::Render(_) => "render_failed",
            CoreError::ProjectLoad(_) => "project_load_failed",
            CoreError::Io(_) | CoreError::Serde(_) | CoreError::Other(_) => "unknown",
        };
        SerializedError {
            kind,
            detail: self.to_string(),
        }
    }
}

impl serde::Serialize for CoreError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.to_serialized().serialize(serializer)
    }
}

pub type CoreResult<T> = Result<T, CoreError>;
