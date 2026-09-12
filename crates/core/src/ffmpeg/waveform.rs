//! Audio waveform extraction for the timeline (design doc section 36).
//!
//! FFmpeg decodes the audio to mono 16-bit PCM at a low sample rate; the peaks
//! are then reduced to a fixed number of buckets so the payload sent to the UI
//! stays small regardless of clip length.

use crate::error::CoreResult;
use crate::ffmpeg::{ffmpeg_binary, run};
use std::path::Path;
use std::process::Command;

/// Buckets per second of audio. 40 keeps a 10 minute file under 25k samples
/// while still showing individual syllables at normal zoom.
pub const BUCKETS_PER_SECOND: f64 = 40.0;

/// Sample rate used for analysis. Peak shape does not need full fidelity.
pub const ANALYSIS_SAMPLE_RATE: u32 = 8_000;

pub fn generate(path: &Path, duration: f64) -> CoreResult<Vec<f32>> {
    let output = run(Command::new(ffmpeg_binary()).args([
        "-v",
        "error",
        "-i",
        &path.display().to_string(),
        "-ac",
        "1",
        "-ar",
        &ANALYSIS_SAMPLE_RATE.to_string(),
        "-f",
        "s16le",
        "-acodec",
        "pcm_s16le",
        "-",
    ]))?;

    Ok(peaks_from_pcm(&output.stdout, bucket_count(duration)))
}

pub fn bucket_count(duration: f64) -> usize {
    ((duration.max(0.0) * BUCKETS_PER_SECOND).ceil() as usize).clamp(1, 200_000)
}

/// Reduces signed 16-bit little-endian PCM to `buckets` normalised peaks (0..1).
pub fn peaks_from_pcm(pcm: &[u8], buckets: usize) -> Vec<f32> {
    let sample_count = pcm.len() / 2;
    if sample_count == 0 || buckets == 0 {
        return vec![0.0; buckets];
    }

    let mut result = Vec::with_capacity(buckets);
    for bucket in 0..buckets {
        let start = bucket * sample_count / buckets;
        let end = ((bucket + 1) * sample_count / buckets).max(start + 1);

        let mut peak: i32 = 0;
        for index in start..end.min(sample_count) {
            let byte = index * 2;
            let sample = i16::from_le_bytes([pcm[byte], pcm[byte + 1]]) as i32;
            peak = peak.max(sample.abs());
        }
        result.push((peak as f32 / i16::MAX as f32).clamp(0.0, 1.0));
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pcm(samples: &[i16]) -> Vec<u8> {
        samples.iter().flat_map(|s| s.to_le_bytes()).collect()
    }

    #[test]
    fn reduces_samples_into_the_requested_buckets() {
        let peaks = peaks_from_pcm(&pcm(&[0; 100]), 10);
        assert_eq!(peaks.len(), 10);
    }

    #[test]
    fn normalises_a_full_scale_peak_to_one() {
        let peaks = peaks_from_pcm(&pcm(&[i16::MAX, 0, 0, 0]), 1);
        assert!((peaks[0] - 1.0).abs() < 1e-3);
    }

    #[test]
    fn silence_reads_as_zero() {
        let peaks = peaks_from_pcm(&pcm(&[0; 64]), 4);
        assert!(peaks.iter().all(|value| *value == 0.0));
    }

    #[test]
    fn takes_the_absolute_peak_of_each_bucket() {
        // Second half is louder, and negative - the magnitude is what matters.
        let peaks = peaks_from_pcm(&pcm(&[100, 100, -20_000, -20_000]), 2);
        assert!(peaks[0] < peaks[1]);
        assert!(peaks[1] > 0.5);
    }

    #[test]
    fn empty_audio_yields_a_flat_line_not_a_panic() {
        assert_eq!(peaks_from_pcm(&[], 5), vec![0.0; 5]);
    }

    #[test]
    fn bucket_count_scales_with_duration_and_is_bounded() {
        assert_eq!(bucket_count(1.0), BUCKETS_PER_SECOND as usize);
        assert_eq!(bucket_count(0.0), 1);
        assert!(bucket_count(1e9) <= 200_000);
    }
}
