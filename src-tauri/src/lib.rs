//! Desktop shell. Owns the window, the IPC surface and process-wide state;
//! all editing logic lives in the `ave-core` crate.

pub mod commands;

use ave_core::jobs::JobRegistry;
use ave_core::media::MediaRegistry;

/// Process-wide state shared by every command.
#[derive(Default)]
pub struct AppState {
    pub media: MediaRegistry,
    pub jobs: JobRegistry,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::probe_media,
            commands::import_media,
            commands::generate_thumbnail,
            commands::generate_proxy,
            commands::generate_waveform,
            commands::save_project,
            commands::load_project,
            commands::list_recent_projects,
            commands::analyze_media,
            commands::extract_audio,
            commands::transcribe_audio,
            commands::save_transcript,
            commands::load_settings,
            commands::save_settings,
            commands::resolve_api_key,
            commands::start_export,
            commands::cancel_job,
            commands::list_jobs,
        ])
        .run(tauri::generate_context!())
        .expect("error while running AI Video Editor");
}
