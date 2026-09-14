//! Multicam angle synchronisation (design doc section 58).
//!
//! Angles are aligned by cross-correlating their audio envelopes: the same
//! clap, word or door slam appears in every camera, and the lag that maximises
//! correlation is the offset between them. This needs no timecode and no
//! external tooling.

use crate::error::CoreResult;
use crate::ffmpeg::waveform;
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AngleSync {
    pub media_id: String,
    /// Seconds this angle should be shifted to line up with the reference.
    pub offset: f64,
    /// Correlation at the chosen offset, 0..1. Low means "check this by hand".
    pub confidence: f64,
}

/// Largest offset searched for, in seconds. Cameras started more than a couple
/// of minutes apart are a manual job.
pub const MAX_OFFSET_SECONDS: f64 = 120.0;

/// Finds the lag, in samples, that best aligns `candidate` with `reference`.
///
/// Both are amplitude envelopes sampled at the same rate. Returns the lag and
/// the normalised correlation at that lag.
pub fn best_lag(reference: &[f32], candidate: &[f32], max_lag: usize) -> (isize, f64) {
    if reference.is_empty() || candidate.is_empty() {
        return (0, 0.0);
    }

    let mut best = (0isize, -1.0f64);
    let max_lag = max_lag.min(reference.len().max(candidate.len()));

    for lag in -(max_lag as isize)..=(max_lag as isize) {
        let score = correlation_at(reference, candidate, lag);
        if score > best.1 {
            best = (lag, score);
        }
    }
    (best.0, best.1.max(0.0))
}

/// Normalised correlation of two envelopes with `candidate` shifted by `lag`.
fn correlation_at(reference: &[f32], candidate: &[f32], lag: isize) -> f64 {
    let mut sum = 0.0;
    let mut reference_energy = 0.0;
    let mut candidate_energy = 0.0;
    let mut overlap = 0usize;

    for (index, value) in reference.iter().enumerate() {
        let shifted = index as isize - lag;
        if shifted < 0 || shifted as usize >= candidate.len() {
            continue;
        }
        let a = *value as f64;
        let b = candidate[shifted as usize] as f64;
        sum += a * b;
        reference_energy += a * a;
        candidate_energy += b * b;
        overlap += 1;
    }

    // Too little overlap makes the correlation meaningless.
    if overlap < 8 {
        return 0.0;
    }
    let denominator = (reference_energy * candidate_energy).sqrt();
    if denominator <= f64::EPSILON {
        return 0.0;
    }
    sum / denominator
}

/// Synchronises a set of angles against the first one.
pub fn synchronise(paths: &[(String, &Path, f64)]) -> CoreResult<Vec<AngleSync>> {
    let Some((reference_id, reference_path, reference_duration)) = paths.first() else {
        return Ok(Vec::new());
    };

    let reference = waveform::generate(reference_path, *reference_duration)?;
    let max_lag = (MAX_OFFSET_SECONDS * waveform::BUCKETS_PER_SECOND) as usize;

    let mut result = vec![AngleSync {
        media_id: reference_id.clone(),
        offset: 0.0,
        confidence: 1.0,
    }];

    for (media_id, path, duration) in paths.iter().skip(1) {
        let candidate = waveform::generate(path, *duration)?;
        let (lag, confidence) = best_lag(&reference, &candidate, max_lag);

        result.push(AngleSync {
            media_id: media_id.clone(),
            offset: lag as f64 / waveform::BUCKETS_PER_SECOND,
            confidence,
        });
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// An envelope with a burst of sound at `at`.
    fn envelope(length: usize, at: usize) -> Vec<f32> {
        let mut values = vec![0.02f32; length];
        for value in values.iter_mut().take((at + 6).min(length)).skip(at) {
            *value = 0.9;
        }
        values
    }

    #[test]
    fn finds_a_zero_lag_for_identical_audio() {
        let reference = envelope(200, 50);
        let (lag, confidence) = best_lag(&reference, &reference, 60);
        assert_eq!(lag, 0);
        assert!(confidence > 0.99);
    }

    #[test]
    fn finds_the_lag_of_a_delayed_angle() {
        let reference = envelope(200, 50);
        let delayed = envelope(200, 70);
        let (lag, confidence) = best_lag(&reference, &delayed, 60);
        // The burst is 20 samples later in the candidate.
        assert_eq!(lag, -20);
        assert!(confidence > 0.9);
    }

    #[test]
    fn finds_the_lag_of_an_early_angle() {
        let reference = envelope(200, 70);
        let early = envelope(200, 50);
        let (lag, _) = best_lag(&reference, &early, 60);
        assert_eq!(lag, 20);
    }

    #[test]
    fn reports_low_confidence_for_unrelated_audio() {
        let reference = envelope(200, 50);
        let noise: Vec<f32> = (0..200).map(|i| ((i % 7) as f32) / 100.0).collect();
        let (_, confidence) = best_lag(&reference, &noise, 60);
        assert!(confidence < 0.9);
    }

    #[test]
    fn empty_audio_is_not_a_panic() {
        assert_eq!(best_lag(&[], &[0.1], 10), (0, 0.0));
        assert_eq!(best_lag(&[0.1], &[], 10), (0, 0.0));
    }

    #[test]
    fn silence_correlates_to_nothing() {
        let silence = vec![0.0f32; 100];
        let (_, confidence) = best_lag(&silence, &silence, 20);
        assert_eq!(confidence, 0.0);
    }

    #[test]
    fn a_lag_beyond_the_search_window_is_not_found() {
        let reference = envelope(400, 20);
        let very_late = envelope(400, 300);
        let (_, confidence) = best_lag(&reference, &very_late, 10);
        assert!(confidence < 0.5);
    }
}
