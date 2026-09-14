//! Application settings, stored outside the project file.
//!
//! API keys never go into project.json - a project is shared, a key is not
//! (design doc section 26 note on AIProviderConfig).

use crate::error::CoreResult;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechEngineSettings {
    /// Path to a local speech-to-text executable, e.g. whisper-cli.
    pub binary: String,
    pub model: String,
    pub language: String,
}

impl Default for SpeechEngineSettings {
    fn default() -> Self {
        Self {
            binary: String::new(),
            model: String::new(),
            language: "auto".into(),
        }
    }
}

impl SpeechEngineSettings {
    pub fn is_configured(&self) -> bool {
        !self.binary.trim().is_empty() && !self.model.trim().is_empty()
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default)]
    pub speech: SpeechEngineSettings,
    /// "openai" | "local" | "mock"
    #[serde(default)]
    pub ai_provider: String,
    #[serde(default)]
    pub ai_model: String,
    #[serde(default)]
    pub ai_endpoint: String,
    #[serde(default)]
    pub ai_api_key: String,
    /// Optional external object detector executable (Phase 4).
    #[serde(default)]
    pub detector_binary: String,
}

pub fn settings_path() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("ai-video-editor")
        .join("settings.json")
}

pub fn load() -> AppSettings {
    // Settings are best-effort: a corrupt file must not stop the app starting.
    std::fs::read(settings_path())
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

pub fn save(settings: &AppSettings) -> CoreResult<()> {
    let path = settings_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&path, serde_json::to_vec_pretty(settings)?)?;
    Ok(())
}

/// Settings with the API key removed, for sending to the UI.
pub fn redacted(settings: &AppSettings) -> AppSettings {
    AppSettings {
        ai_api_key: if settings.ai_api_key.is_empty() {
            String::new()
        } else {
            "********".into()
        },
        ..settings.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_speech_engine_needs_both_a_binary_and_a_model() {
        let mut speech = SpeechEngineSettings::default();
        assert!(!speech.is_configured());

        speech.binary = "whisper-cli".into();
        assert!(!speech.is_configured());

        speech.model = "ggml-base.bin".into();
        assert!(speech.is_configured());
    }

    #[test]
    fn blank_entries_do_not_count_as_configured() {
        let speech = SpeechEngineSettings {
            binary: "   ".into(),
            model: "m".into(),
            language: "ja".into(),
        };
        assert!(!speech.is_configured());
    }

    #[test]
    fn the_api_key_is_redacted_before_it_reaches_the_ui() {
        let settings = AppSettings {
            ai_api_key: "sk-secret".into(),
            ai_model: "gpt-4o".into(),
            ..Default::default()
        };
        let safe = redacted(&settings);
        assert_eq!(safe.ai_api_key, "********");
        assert_eq!(safe.ai_model, "gpt-4o");
    }

    #[test]
    fn an_absent_key_stays_empty_rather_than_looking_set() {
        assert_eq!(redacted(&AppSettings::default()).ai_api_key, "");
    }
}
