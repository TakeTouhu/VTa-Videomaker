//! Media cache layout (design doc section 35).
//!
//! /cache/
//!    thumbnails/  waveform/  proxies/  transcripts/  ai/

use crate::error::CoreResult;
use std::path::{Path, PathBuf};

pub fn cache_root() -> PathBuf {
    dirs::cache_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("ai-video-editor")
}

pub fn subdirectory(name: &str) -> CoreResult<PathBuf> {
    let path = cache_root().join(name);
    std::fs::create_dir_all(&path)?;
    Ok(path)
}

pub fn thumbnail_path(media_id: &str) -> CoreResult<PathBuf> {
    Ok(subdirectory("thumbnails")?.join(format!("{media_id}.jpg")))
}

pub fn proxy_path(media_id: &str) -> CoreResult<PathBuf> {
    Ok(subdirectory("proxies")?.join(format!("{media_id}.mp4")))
}

pub fn waveform_path(media_id: &str) -> CoreResult<PathBuf> {
    Ok(subdirectory("waveform")?.join(format!("{media_id}.json")))
}

pub fn transcript_path(media_id: &str) -> CoreResult<PathBuf> {
    Ok(subdirectory("transcripts")?.join(format!("{media_id}.json")))
}

/// Total size of the cache in bytes, for the settings screen.
pub fn cache_size() -> u64 {
    fn walk(path: &Path) -> u64 {
        let Ok(entries) = std::fs::read_dir(path) else {
            return 0;
        };
        entries
            .flatten()
            .map(|entry| match entry.metadata() {
                Ok(metadata) if metadata.is_dir() => walk(&entry.path()),
                Ok(metadata) => metadata.len(),
                Err(_) => 0,
            })
            .sum()
    }
    walk(&cache_root())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paths_are_namespaced_per_media_id() {
        let a = thumbnail_path("media_1").unwrap();
        let b = thumbnail_path("media_2").unwrap();
        assert_ne!(a, b);
        assert!(a.to_string_lossy().ends_with("media_1.jpg"));
    }

    #[test]
    fn caches_live_under_one_root() {
        let root = cache_root();
        assert!(proxy_path("m").unwrap().starts_with(&root));
        assert!(transcript_path("m").unwrap().starts_with(&root));
    }
}
