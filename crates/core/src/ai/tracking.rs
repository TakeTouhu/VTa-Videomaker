//! Mask motion tracking (design doc section 17).
//!
//! A real tracker, not a stub: FFmpeg decodes a grayscale strip of the clip,
//! and the region under the mask is followed frame to frame with normalised
//! cross-correlation over a bounded search window. No model, no network.
//!
//! NCC is chosen because it is invariant to brightness changes, which is what
//! breaks naive difference-based tracking when someone walks past a window.

use crate::error::{CoreError, CoreResult};
use crate::ffmpeg::{ffmpeg_binary, run};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Command;

/// Frames per second sampled while tracking. 10 is enough to follow a person
/// and keeps a minute of footage to a few hundred correlations.
pub const TRACK_FPS: f64 = 10.0;
/// Width the frames are scaled to. Tracking does not need full resolution.
pub const TRACK_WIDTH: u32 = 320;
/// How far, in pixels, the target may move between sampled frames.
pub const SEARCH_RADIUS: i32 = 24;
/// Below this correlation the match is reported as unreliable.
pub const MIN_CONFIDENCE: f64 = 0.5;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TrackSample {
    pub time: f64,
    pub offset_x: f64,
    pub offset_y: f64,
    pub scale: f64,
    pub confidence: f64,
}

/// A decoded grayscale frame.
pub struct Frame {
    pub width: usize,
    pub height: usize,
    pub pixels: Vec<u8>,
}

impl Frame {
    fn at(&self, x: usize, y: usize) -> f64 {
        self.pixels[y * self.width + x] as f64
    }
}

/// Decodes the clip to a grayscale strip of frames.
pub fn decode_frames(source: &Path, start: f64, duration: f64) -> CoreResult<Vec<Frame>> {
    let output = run(Command::new(ffmpeg_binary()).args([
        "-v",
        "error",
        "-ss",
        &format!("{start:.4}"),
        "-t",
        &format!("{duration:.4}"),
        "-i",
        &source.display().to_string(),
        "-vf",
        &format!("fps={TRACK_FPS},scale={TRACK_WIDTH}:-2,format=gray"),
        "-f",
        "rawvideo",
        "-pix_fmt",
        "gray",
        "-",
    ]))?;

    // The height is not known until the scaler has run, so it is derived from
    // the payload size and the frame count implied by the duration.
    let expected_frames = ((duration * TRACK_FPS).round() as usize).max(1);
    split_frames(&output.stdout, TRACK_WIDTH as usize, expected_frames)
}

/// Splits a raw grayscale stream into frames of `width` columns.
pub fn split_frames(data: &[u8], width: usize, expected_frames: usize) -> CoreResult<Vec<Frame>> {
    if data.is_empty() || width == 0 {
        return Ok(Vec::new());
    }
    let total_pixels = data.len();
    let height = total_pixels / (width * expected_frames.max(1));
    if height == 0 {
        return Err(CoreError::Other(
            "追跡用フレームのデコードに失敗しました".into(),
        ));
    }

    let frame_size = width * height;
    Ok(data
        .chunks_exact(frame_size)
        .map(|chunk| Frame {
            width,
            height,
            pixels: chunk.to_vec(),
        })
        .collect())
}

/// Normalised cross-correlation of a template against a frame region.
///
/// Returns -1..1; 1 is a perfect match. Zero-variance regions (flat colour)
/// return 0 because the correlation is undefined there.
pub fn correlation(frame: &Frame, template: &Frame, origin_x: i32, origin_y: i32) -> f64 {
    if origin_x < 0
        || origin_y < 0
        || origin_x as usize + template.width > frame.width
        || origin_y as usize + template.height > frame.height
    {
        return -1.0;
    }

    let count = (template.width * template.height) as f64;
    let mut frame_sum = 0.0;
    let mut template_sum = 0.0;

    for y in 0..template.height {
        for x in 0..template.width {
            frame_sum += frame.at(origin_x as usize + x, origin_y as usize + y);
            template_sum += template.at(x, y);
        }
    }
    let frame_mean = frame_sum / count;
    let template_mean = template_sum / count;

    let mut numerator = 0.0;
    let mut frame_variance = 0.0;
    let mut template_variance = 0.0;

    for y in 0..template.height {
        for x in 0..template.width {
            let f = frame.at(origin_x as usize + x, origin_y as usize + y) - frame_mean;
            let t = template.at(x, y) - template_mean;
            numerator += f * t;
            frame_variance += f * f;
            template_variance += t * t;
        }
    }

    let denominator = (frame_variance * template_variance).sqrt();
    if denominator <= f64::EPSILON {
        return 0.0;
    }
    numerator / denominator
}

/// Copies a rectangular patch out of a frame.
pub fn crop(frame: &Frame, x: usize, y: usize, width: usize, height: usize) -> Frame {
    let width = width.min(frame.width.saturating_sub(x)).max(1);
    let height = height.min(frame.height.saturating_sub(y)).max(1);

    let mut pixels = Vec::with_capacity(width * height);
    for row in 0..height {
        let start = (y + row) * frame.width + x;
        pixels.extend_from_slice(&frame.pixels[start..start + width]);
    }
    Frame {
        width,
        height,
        pixels,
    }
}

/// Finds the best match for `template` near (`from_x`, `from_y`).
pub fn find_best_match(
    frame: &Frame,
    template: &Frame,
    from_x: i32,
    from_y: i32,
    radius: i32,
) -> (i32, i32, f64) {
    let mut best = (from_x, from_y, -1.0);

    for dy in -radius..=radius {
        for dx in -radius..=radius {
            let score = correlation(frame, template, from_x + dx, from_y + dy);
            if score > best.2 {
                best = (from_x + dx, from_y + dy, score);
            }
        }
    }
    best
}

/// Tracks a normalised region through the decoded frames.
///
/// The template is refreshed whenever the match is strong, so gradual changes
/// in appearance are followed; a weak match keeps the previous template rather
/// than locking onto the background.
pub fn track_region(frames: &[Frame], region: (f64, f64, f64, f64)) -> Vec<TrackSample> {
    let Some(first) = frames.first() else {
        return Vec::new();
    };

    let (rx, ry, rw, rh) = region;
    let start_x = (rx * first.width as f64).round().max(0.0) as usize;
    let start_y = (ry * first.height as f64).round().max(0.0) as usize;
    let width = ((rw * first.width as f64).round() as usize).clamp(4, first.width);
    let height = ((rh * first.height as f64).round() as usize).clamp(4, first.height);

    let mut template = crop(first, start_x, start_y, width, height);
    let mut position = (start_x as i32, start_y as i32);

    let mut samples = vec![TrackSample {
        time: 0.0,
        offset_x: 0.0,
        offset_y: 0.0,
        scale: 1.0,
        confidence: 1.0,
    }];

    for (index, frame) in frames.iter().enumerate().skip(1) {
        let (x, y, score) =
            find_best_match(frame, &template, position.0, position.1, SEARCH_RADIUS);

        // A weak match means the target is occluded or gone: hold the last
        // known position rather than jumping to a random high point.
        if score >= MIN_CONFIDENCE {
            position = (x, y);
            template = crop(frame, x.max(0) as usize, y.max(0) as usize, width, height);
        }

        samples.push(TrackSample {
            time: index as f64 / TRACK_FPS,
            offset_x: (position.0 - start_x as i32) as f64 / first.width as f64,
            offset_y: (position.1 - start_y as i32) as f64 / first.height as f64,
            // Scale estimation needs a multi-scale search; the shape is kept at
            // its authored size until that lands.
            scale: 1.0,
            confidence: score.max(0.0),
        });
    }
    samples
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A frame with a bright square at (x, y).
    fn frame_with_square(width: usize, height: usize, x: usize, y: usize, size: usize) -> Frame {
        let mut pixels = vec![40u8; width * height];
        for row in y..(y + size).min(height) {
            for column in x..(x + size).min(width) {
                pixels[row * width + column] = 220;
            }
        }
        Frame {
            width,
            height,
            pixels,
        }
    }

    // Templates must contain structure: a uniform patch has zero variance and
    // no correlation is defined for it. Cropping around the square includes
    // its edges, which is exactly what a real mask region looks like.
    #[test]
    fn correlation_is_one_for_an_exact_match() {
        let frame = frame_with_square(64, 64, 10, 10, 8);
        let template = crop(&frame, 8, 8, 12, 12);
        assert!((correlation(&frame, &template, 8, 8) - 1.0).abs() < 1e-9);
    }

    #[test]
    fn correlation_is_low_for_the_wrong_position() {
        let frame = frame_with_square(64, 64, 10, 10, 8);
        let template = crop(&frame, 8, 8, 12, 12);
        assert!(correlation(&frame, &template, 40, 40) < 0.5);
    }

    #[test]
    fn correlation_rejects_an_out_of_bounds_origin() {
        let frame = frame_with_square(32, 32, 4, 4, 4);
        let template = crop(&frame, 2, 2, 8, 8);
        assert_eq!(correlation(&frame, &template, -5, 0), -1.0);
        assert_eq!(correlation(&frame, &template, 30, 30), -1.0);
    }

    #[test]
    fn correlation_is_zero_on_a_flat_region() {
        let flat = Frame {
            width: 16,
            height: 16,
            pixels: vec![100; 256],
        };
        let template = crop(&flat, 0, 0, 4, 4);
        assert_eq!(correlation(&flat, &template, 4, 4), 0.0);
    }

    #[test]
    fn finds_a_target_that_moved() {
        let first = frame_with_square(64, 64, 10, 10, 8);
        let second = frame_with_square(64, 64, 18, 14, 8);
        let template = crop(&first, 8, 8, 12, 12);

        let (x, y, score) = find_best_match(&second, &template, 8, 8, SEARCH_RADIUS);
        // The square moved by (8, 4), so the template's origin moves with it.
        assert_eq!((x, y), (16, 12));
        assert!(score > 0.9);
    }

    #[test]
    fn tracks_a_moving_target_across_frames() {
        let frames: Vec<Frame> = (0..5)
            .map(|index| frame_with_square(64, 64, 10 + index * 3, 10, 8))
            .collect();

        let samples = track_region(&frames, (8.0 / 64.0, 8.0 / 64.0, 12.0 / 64.0, 12.0 / 64.0));
        assert_eq!(samples.len(), 5);
        // The target drifts right, so the offset grows and stays vertical-free.
        assert!(samples[4].offset_x > samples[1].offset_x);
        assert!(samples[4].offset_x > 0.15);
        assert!(samples[4].offset_y.abs() < 0.02);
    }

    #[test]
    fn holds_position_when_the_target_disappears() {
        let mut frames = vec![frame_with_square(64, 64, 10, 10, 8)];
        // Second frame is flat: nothing to lock onto.
        frames.push(Frame {
            width: 64,
            height: 64,
            pixels: vec![40; 64 * 64],
        });

        let samples = track_region(&frames, (8.0 / 64.0, 8.0 / 64.0, 12.0 / 64.0, 12.0 / 64.0));
        assert_eq!(samples[1].offset_x, 0.0);
        assert!(samples[1].confidence < MIN_CONFIDENCE);
    }

    #[test]
    fn timestamps_follow_the_sample_rate() {
        let frames: Vec<Frame> = (0..3).map(|_| frame_with_square(32, 32, 8, 8, 6)).collect();
        let samples = track_region(&frames, (0.1875, 0.1875, 0.3125, 0.3125));
        assert!((samples[2].time - 2.0 / TRACK_FPS).abs() < 1e-9);
    }

    #[test]
    fn tracking_an_empty_strip_yields_nothing() {
        assert!(track_region(&[], (0.0, 0.0, 0.5, 0.5)).is_empty());
    }

    #[test]
    fn splits_a_raw_stream_into_frames() {
        let data = vec![0u8; 4 * 3 * 2];
        let frames = split_frames(&data, 4, 2).unwrap();
        assert_eq!(frames.len(), 2);
        assert_eq!(frames[0].height, 3);
    }

    #[test]
    fn an_empty_stream_is_not_an_error() {
        assert!(split_frames(&[], 4, 2).unwrap().is_empty());
    }
}
