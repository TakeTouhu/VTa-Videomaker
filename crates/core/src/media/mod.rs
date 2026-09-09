//! Media library: import, registry, and the derived-asset paths.

use crate::error::CoreResult;
use crate::ffmpeg::probe::{self, MediaProbe};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaItem {
    pub id: String,
    #[serde(rename = "type")]
    pub media_type: String,
    pub name: String,
    pub source_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub proxy_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thumbnail_path: Option<String>,
    pub duration: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fps: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audio_channels: Option<u32>,
    pub analysis_state: String,
    pub imported_at: String,
}

/// Classifies a file by extension, before ffprobe confirms it.
pub fn media_type_for(path: &Path) -> &'static str {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_lowercase();

    match extension.as_str() {
        "wav" | "mp3" | "aac" | "m4a" | "flac" | "ogg" => "audio",
        "png" | "jpg" | "jpeg" | "webp" | "bmp" | "gif" => "image",
        _ => "video",
    }
}

pub fn import(path: &Path, id: String, now: String) -> CoreResult<MediaItem> {
    let declared = media_type_for(path);
    let probe: MediaProbe = if declared == "image" {
        MediaProbe {
            // Stills get a nominal duration so they can be placed on a track.
            duration: 5.0,
            has_video: true,
            ..Default::default()
        }
    } else {
        probe::probe(path)?
    };

    Ok(MediaItem {
        id,
        media_type: if declared == "video" && !probe.has_video {
            "audio".to_string()
        } else {
            declared.to_string()
        },
        name: path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("media")
            .to_string(),
        source_path: path.display().to_string(),
        proxy_path: None,
        thumbnail_path: None,
        duration: probe.duration,
        width: probe.width,
        height: probe.height,
        fps: probe.fps,
        audio_channels: probe.audio_channels,
        analysis_state: "not_started".to_string(),
        imported_at: now,
    })
}

/// Media ids to source paths, so the renderer can resolve a clip's file.
#[derive(Default)]
pub struct MediaRegistry {
    items: Mutex<HashMap<String, MediaItem>>,
}

impl MediaRegistry {
    pub fn insert(&self, item: MediaItem) {
        self.items
            .lock()
            .expect("media registry poisoned")
            .insert(item.id.clone(), item);
    }

    pub fn get(&self, id: &str) -> Option<MediaItem> {
        self.items
            .lock()
            .expect("media registry poisoned")
            .get(id)
            .cloned()
    }

    pub fn source_paths(&self) -> HashMap<String, PathBuf> {
        self.items
            .lock()
            .expect("media registry poisoned")
            .iter()
            .map(|(id, item)| (id.clone(), PathBuf::from(&item.source_path)))
            .collect()
    }

    pub fn update(&self, id: &str, mutate: impl FnOnce(&mut MediaItem)) {
        if let Some(item) = self
            .items
            .lock()
            .expect("media registry poisoned")
            .get_mut(id)
        {
            mutate(item);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_by_extension() {
        assert_eq!(media_type_for(Path::new("a.mp4")), "video");
        assert_eq!(media_type_for(Path::new("a.WAV")), "audio");
        assert_eq!(media_type_for(Path::new("a.png")), "image");
    }

    #[test]
    fn registry_exposes_paths_for_the_renderer() {
        let registry = MediaRegistry::default();
        registry.insert(MediaItem {
            id: "m1".into(),
            media_type: "video".into(),
            name: "a.mp4".into(),
            source_path: "/tmp/a.mp4".into(),
            proxy_path: None,
            thumbnail_path: None,
            duration: 3.0,
            width: None,
            height: None,
            fps: None,
            audio_channels: None,
            analysis_state: "not_started".into(),
            imported_at: "now".into(),
        });

        let paths = registry.source_paths();
        assert_eq!(paths.get("m1").unwrap(), &PathBuf::from("/tmp/a.mp4"));
    }
}
