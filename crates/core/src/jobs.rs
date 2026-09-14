//! Background job queue (design doc section 53).
//!
//! Heavy work - proxies, transcription, export - runs off the UI thread and
//! reports progress through Tauri events.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum JobStatus {
    Queued,
    Running,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundJob {
    pub id: String,
    #[serde(rename = "type")]
    pub job_type: String,
    pub status: JobStatus,
    pub progress: f64,
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub media_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub eta_seconds: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl BackgroundJob {
    pub fn new(id: String, job_type: &str, label: String) -> Self {
        Self {
            id,
            job_type: job_type.to_string(),
            status: JobStatus::Queued,
            progress: 0.0,
            label,
            media_id: None,
            eta_seconds: None,
            error: None,
        }
    }
}

/// Registry of running jobs and their cancellation flags.
#[derive(Default)]
pub struct JobRegistry {
    jobs: Mutex<HashMap<String, BackgroundJob>>,
    cancels: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl JobRegistry {
    pub fn insert(&self, job: BackgroundJob) -> Arc<AtomicBool> {
        let cancel = Arc::new(AtomicBool::new(false));
        self.cancels
            .lock()
            .expect("job registry poisoned")
            .insert(job.id.clone(), Arc::clone(&cancel));
        self.jobs
            .lock()
            .expect("job registry poisoned")
            .insert(job.id.clone(), job);
        cancel
    }

    pub fn update(
        &self,
        id: &str,
        mutate: impl FnOnce(&mut BackgroundJob),
    ) -> Option<BackgroundJob> {
        let mut jobs = self.jobs.lock().expect("job registry poisoned");
        let job = jobs.get_mut(id)?;
        mutate(job);
        Some(job.clone())
    }

    pub fn cancel(&self, id: &str) {
        if let Some(flag) = self.cancels.lock().expect("job registry poisoned").get(id) {
            flag.store(true, Ordering::Relaxed);
        }
        self.update(id, |job| {
            job.status = JobStatus::Cancelled;
        });
    }

    pub fn list(&self) -> Vec<BackgroundJob> {
        self.jobs
            .lock()
            .expect("job registry poisoned")
            .values()
            .cloned()
            .collect()
    }

    /// Drops finished jobs so the list does not grow without bound.
    pub fn prune_finished(&self) {
        self.jobs
            .lock()
            .expect("job registry poisoned")
            .retain(|_, job| matches!(job.status, JobStatus::Queued | JobStatus::Running));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tracks_and_updates_a_job() {
        let registry = JobRegistry::default();
        registry.insert(BackgroundJob::new("j1".into(), "proxy", "Proxy".into()));

        registry.update("j1", |job| {
            job.status = JobStatus::Running;
            job.progress = 0.5;
        });

        let jobs = registry.list();
        assert_eq!(jobs.len(), 1);
        assert_eq!(jobs[0].progress, 0.5);
    }

    #[test]
    fn cancelling_sets_the_flag_the_worker_reads() {
        let registry = JobRegistry::default();
        let cancel = registry.insert(BackgroundJob::new("j1".into(), "export", "Export".into()));

        assert!(!cancel.load(Ordering::Relaxed));
        registry.cancel("j1");
        assert!(cancel.load(Ordering::Relaxed));
        assert_eq!(registry.list()[0].status, JobStatus::Cancelled);
    }

    #[test]
    fn pruning_keeps_only_active_jobs() {
        let registry = JobRegistry::default();
        registry.insert(BackgroundJob::new("a".into(), "proxy", "a".into()));
        registry.insert(BackgroundJob::new("b".into(), "proxy", "b".into()));
        registry.update("b", |job| job.status = JobStatus::Completed);

        registry.prune_finished();
        assert_eq!(registry.list().len(), 1);
    }
}
