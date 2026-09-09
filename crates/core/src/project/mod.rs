//! Project persistence: project.json plus rolling autosave backups
//! (design doc section 33).

use crate::error::{CoreError, CoreResult};
use serde_json::Value;
use std::path::{Path, PathBuf};

pub const PROJECT_FILE: &str = "project.json";
pub const AUTOSAVE_DIR: &str = "autosave";
/// Keep a bounded history so autosave cannot fill the disk.
pub const MAX_AUTOSAVES: usize = 20;

/// Writes the project atomically: a crash mid-write must never destroy the
/// previous good file.
pub fn save(project: &Value, directory: &Path) -> CoreResult<PathBuf> {
    std::fs::create_dir_all(directory)?;
    let destination = directory.join(PROJECT_FILE);
    let temporary = directory.join(format!("{PROJECT_FILE}.tmp"));

    std::fs::write(&temporary, serde_json::to_vec_pretty(project)?)?;
    std::fs::rename(&temporary, &destination)?;
    Ok(destination)
}

pub fn load(path: &Path) -> CoreResult<Value> {
    if !path.exists() {
        return Err(CoreError::FileNotFound(path.display().to_string()));
    }
    let bytes = std::fs::read(path)?;
    serde_json::from_slice(&bytes)
        .map_err(|error| CoreError::ProjectLoad(format!("invalid project.json: {error}")))
}

/// Writes a timestamped backup and prunes the oldest ones.
pub fn write_autosave(project: &Value, directory: &Path, stamp: &str) -> CoreResult<PathBuf> {
    let autosave_dir = directory.join(AUTOSAVE_DIR);
    std::fs::create_dir_all(&autosave_dir)?;

    let destination = autosave_dir.join(format!("project-{stamp}.json"));
    std::fs::write(&destination, serde_json::to_vec_pretty(project)?)?;
    prune_autosaves(&autosave_dir)?;
    Ok(destination)
}

fn prune_autosaves(directory: &Path) -> CoreResult<()> {
    let mut entries: Vec<PathBuf> = std::fs::read_dir(directory)?
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.extension().and_then(|ext| ext.to_str()) == Some("json"))
        .collect();

    if entries.len() <= MAX_AUTOSAVES {
        return Ok(());
    }
    // File names embed a sortable timestamp, so lexical order is chronological.
    entries.sort();
    for path in entries.iter().take(entries.len() - MAX_AUTOSAVES) {
        let _ = std::fs::remove_file(path);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!("ave-test-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&path);
        path
    }

    #[test]
    fn saves_and_loads_a_project() {
        let directory = temp_dir("save");
        let project = serde_json::json!({ "id": "p1", "name": "Test" });

        let saved = save(&project, &directory).unwrap();
        let loaded = load(&saved).unwrap();

        assert_eq!(loaded["name"], "Test");
        let _ = std::fs::remove_dir_all(&directory);
    }

    #[test]
    fn loading_a_missing_project_reports_file_not_found() {
        let error = load(Path::new("/definitely/not/here.json")).unwrap_err();
        assert!(matches!(error, CoreError::FileNotFound(_)));
    }

    #[test]
    fn loading_invalid_json_reports_project_load() {
        let directory = temp_dir("invalid");
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join("project.json");
        std::fs::write(&path, b"{ not json").unwrap();

        assert!(matches!(
            load(&path).unwrap_err(),
            CoreError::ProjectLoad(_)
        ));
        let _ = std::fs::remove_dir_all(&directory);
    }

    #[test]
    fn autosaves_are_pruned_to_the_limit() {
        let directory = temp_dir("autosave");
        let project = serde_json::json!({ "id": "p1" });

        for index in 0..(MAX_AUTOSAVES + 5) {
            write_autosave(&project, &directory, &format!("{index:04}")).unwrap();
        }

        let count = std::fs::read_dir(directory.join(AUTOSAVE_DIR))
            .unwrap()
            .count();
        assert_eq!(count, MAX_AUTOSAVES);
        let _ = std::fs::remove_dir_all(&directory);
    }
}
