//! AI Video Editor core.
//!
//! Everything that is not the GUI lives here: FFmpeg control, the render
//! engine, media import, the project file, the cache and the analysis
//! pipeline. The crate has no Tauri or GTK dependency, so it builds and its
//! tests run on any platform (design doc section 45).
//!
//!   React UI  ->  Tauri IPC (src-tauri)  ->  ave-core  ->  FFmpeg / AI

pub mod ai;
pub mod cache;
pub mod error;
pub mod ffmpeg;
pub mod filesystem;
pub mod jobs;
pub mod media;
pub mod project;
pub mod render;
pub mod timeline;

pub use error::{CoreError, CoreResult};
