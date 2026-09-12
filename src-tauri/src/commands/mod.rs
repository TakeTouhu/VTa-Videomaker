//! Tauri command surface: the IPC boundary the front end calls.
//!
//! Commands stay thin - they validate inputs, hand off to a core module, and
//! translate errors. No FFmpeg command line is built here.

use crate::AppState;
use ave_core::ai::{silence, MediaAnalysis};
use ave_core::cache;
use ave_core::error::CoreError;
use ave_core::ffmpeg::{probe, proxy, thumbnail, waveform};
use ave_core::jobs::{BackgroundJob, JobStatus};
use ave_core::media::{self, MediaItem};
use ave_core::project;
use ave_core::render::{self, ExportSettings};
use ave_core::timeline::Sequence;
use serde_json::Value;
use std::path::{Path, PathBuf};
use tauri::{Emitter, Manager, State};
use uuid::Uuid;

type CommandResult<T> = Result<T, CoreError>;

fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}

#[tauri::command]
pub fn probe_media(path: String) -> CommandResult<probe::MediaProbe> {
    probe::probe(Path::new(&path))
}

#[tauri::command]
pub fn import_media(paths: Vec<String>, state: State<AppState>) -> CommandResult<Vec<MediaItem>> {
    let mut items = Vec::new();
    for path in paths {
        let item = media::import(Path::new(&path), format!("media_{}", Uuid::new_v4()), now())?;
        state.media.insert(item.clone());
        items.push(item);
    }
    Ok(items)
}

#[tauri::command]
pub fn generate_thumbnail(
    media_id: String,
    at_seconds: f64,
    state: State<AppState>,
) -> CommandResult<String> {
    let item = state
        .media
        .get(&media_id)
        .ok_or_else(|| CoreError::Other(format!("unknown media: {media_id}")))?;

    let destination = cache::thumbnail_path(&media_id)?;
    if destination.exists() {
        return Ok(destination.display().to_string());
    }

    let path = thumbnail::generate(Path::new(&item.source_path), &destination, at_seconds)?;
    state.media.update(&media_id, |item| {
        item.thumbnail_path = Some(path.display().to_string());
    });
    Ok(path.display().to_string())
}

#[tauri::command]
pub async fn generate_proxy(media_id: String, app: tauri::AppHandle) -> CommandResult<String> {
    let state = app.state::<AppState>();
    let item = state
        .media
        .get(&media_id)
        .ok_or_else(|| CoreError::Other(format!("unknown media: {media_id}")))?;

    let destination = cache::proxy_path(&media_id)?;
    if destination.exists() {
        return Ok(destination.display().to_string());
    }

    let job_id = format!("job_{}", Uuid::new_v4());
    let mut job = BackgroundJob::new(job_id.clone(), "proxy", format!("Proxy: {}", item.name));
    job.media_id = Some(media_id.clone());
    job.status = JobStatus::Running;
    state.jobs.insert(job.clone());
    let _ = app.emit("job://update", &job);

    let source = PathBuf::from(&item.source_path);
    let result =
        tauri::async_runtime::spawn_blocking(move || proxy::generate(&source, &destination))
            .await
            .map_err(|error| CoreError::Other(error.to_string()))?;

    let state = app.state::<AppState>();
    match result {
        Ok(path) => {
            let value = path.display().to_string();
            state.media.update(&media_id, |item| {
                item.proxy_path = Some(value.clone());
            });
            if let Some(job) = state.jobs.update(&job_id, |job| {
                job.status = JobStatus::Completed;
                job.progress = 1.0;
            }) {
                let _ = app.emit("job://update", &job);
            }
            Ok(value)
        }
        Err(error) => {
            if let Some(job) = state.jobs.update(&job_id, |job| {
                job.status = JobStatus::Failed;
                job.error = Some(error.to_string());
            }) {
                let _ = app.emit("job://update", &job);
            }
            Err(error)
        }
    }
}

#[tauri::command]
pub async fn generate_waveform(media_id: String, app: tauri::AppHandle) -> CommandResult<Vec<f32>> {
    let item = {
        let state = app.state::<AppState>();
        state
            .media
            .get(&media_id)
            .ok_or_else(|| CoreError::Other(format!("unknown media: {media_id}")))?
    };

    // Waveforms are expensive to extract and never change, so they are cached.
    let cache_path = cache::waveform_path(&media_id)?;
    if let Ok(bytes) = std::fs::read(&cache_path) {
        if let Ok(peaks) = serde_json::from_slice::<Vec<f32>>(&bytes) {
            return Ok(peaks);
        }
    }

    let source = PathBuf::from(&item.source_path);
    let duration = item.duration;
    let peaks = tauri::async_runtime::spawn_blocking(move || waveform::generate(&source, duration))
        .await
        .map_err(|error| CoreError::Other(error.to_string()))??;

    let _ = std::fs::write(&cache_path, serde_json::to_vec(&peaks)?);
    Ok(peaks)
}

#[tauri::command]
pub fn save_project(project: Value, path: Option<String>) -> CommandResult<String> {
    let directory = match path.as_deref() {
        Some(existing) => PathBuf::from(existing)
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| default_project_dir(&project)),
        None => default_project_dir(&project),
    };

    let saved = project::save(&project, &directory)?;
    let stamp = chrono::Utc::now().format("%Y%m%d-%H%M%S").to_string();
    // A failed backup must not fail the save itself.
    let _ = project::write_autosave(&project, &directory, &stamp);
    Ok(saved.display().to_string())
}

fn default_project_dir(project: &Value) -> PathBuf {
    let name = project
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or("Untitled Project");
    let sanitized: String = name
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '_' })
        .collect();

    dirs::document_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("AI Video Editor")
        .join(sanitized)
}

#[tauri::command]
pub fn load_project(path: String) -> CommandResult<Value> {
    project::load(Path::new(&path))
}

#[tauri::command]
pub fn list_recent_projects() -> CommandResult<Vec<Value>> {
    let root = dirs::document_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("AI Video Editor");
    if !root.exists() {
        return Ok(Vec::new());
    }

    let mut recents = Vec::new();
    for entry in std::fs::read_dir(&root)?.flatten() {
        let file = entry.path().join(project::PROJECT_FILE);
        if !file.exists() {
            continue;
        }
        if let Ok(value) = project::load(&file) {
            recents.push(serde_json::json!({
                "id": value.get("id").cloned().unwrap_or(Value::Null),
                "name": value.get("name").cloned().unwrap_or(Value::Null),
                "path": file.display().to_string(),
                "createdAt": value.get("createdAt").cloned().unwrap_or(Value::Null),
                "modifiedAt": value.get("updatedAt").cloned().unwrap_or(Value::Null),
            }));
        }
    }
    Ok(recents)
}

#[tauri::command]
pub async fn analyze_media(
    media_id: String,
    app: tauri::AppHandle,
) -> CommandResult<MediaAnalysis> {
    let item = {
        let state = app.state::<AppState>();
        state
            .media
            .get(&media_id)
            .ok_or_else(|| CoreError::Other(format!("unknown media: {media_id}")))?
    };

    let source = PathBuf::from(&item.source_path);
    let silences = tauri::async_runtime::spawn_blocking(move || {
        silence::detect(
            &source,
            silence::DEFAULT_NOISE_DB,
            silence::DEFAULT_MIN_DURATION,
        )
    })
    .await
    .map_err(|error| CoreError::Other(error.to_string()))??;

    Ok(MediaAnalysis {
        media_id,
        // Speech to text arrives with the Phase 3 provider work.
        transcript: Vec::new(),
        silences,
        scenes: Vec::new(),
        analyzed_at: now(),
    })
}

#[tauri::command]
pub async fn start_export(
    sequence: Sequence,
    settings: ExportSettings,
    app: tauri::AppHandle,
) -> CommandResult<String> {
    ave_core::filesystem::ensure_writable(Path::new(&settings.output_path))?;

    let job_id = format!("job_{}", Uuid::new_v4());
    let (cancel, media_paths) = {
        let state = app.state::<AppState>();
        let mut job = BackgroundJob::new(job_id.clone(), "export", "Export".to_string());
        job.status = JobStatus::Running;
        let cancel = state.jobs.insert(job.clone());
        let _ = app.emit("job://update", &job);
        (cancel, state.media.source_paths())
    };

    let handle = app.clone();
    let id = job_id.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let progress_handle = handle.clone();
        let progress_id = id.clone();

        let result = render::export(&sequence, &settings, &media_paths, cancel, |progress| {
            let state = progress_handle.state::<AppState>();
            if let Some(job) = state
                .jobs
                .update(&progress_id, |job| job.progress = progress)
            {
                let _ = progress_handle.emit("job://update", &job);
            }
        });

        let state = handle.state::<AppState>();
        let updated = state.jobs.update(&id, |job| match &result {
            Ok(_) => {
                job.status = JobStatus::Completed;
                job.progress = 1.0;
            }
            Err(error) => {
                job.status = JobStatus::Failed;
                job.error = Some(error.to_string());
            }
        });
        if let Some(job) = updated {
            let _ = handle.emit("job://update", &job);
        }
    });

    Ok(job_id)
}

#[tauri::command]
pub fn cancel_job(job_id: String, state: State<AppState>) -> CommandResult<()> {
    state.jobs.cancel(&job_id);
    Ok(())
}

#[tauri::command]
pub fn list_jobs(state: State<AppState>) -> CommandResult<Vec<BackgroundJob>> {
    Ok(state.jobs.list())
}
