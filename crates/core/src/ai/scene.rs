//! Scene / shot boundary detection (design doc sections 19.1, 57).
//!
//! Uses FFmpeg's own scene score rather than a model: it is fast, offline, and
//! good enough to cut on. Semantic understanding of what is in the shot is a
//! separate, provider-backed step.

use crate::error::CoreResult;
use crate::ffmpeg::{ffmpeg_binary, run};
use std::path::Path;
use std::process::Command;

/// Frame difference above which a cut is reported. 0.4 is conservative: it
/// finds hard cuts without firing on camera movement.
pub const DEFAULT_THRESHOLD: f64 = 0.4;

pub fn detect(path: &Path, threshold: f64) -> CoreResult<Vec<f64>> {
    let output = run(Command::new(ffmpeg_binary()).args([
        "-i",
        &path.display().to_string(),
        "-filter_complex",
        &format!("select='gt(scene,{threshold})',metadata=print:file=-"),
        "-an",
        "-f",
        "null",
        "-",
    ]))?;

    // metadata=print writes to stdout; older builds log to stderr instead.
    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut scenes = parse_scene_times(&stdout);
    if scenes.is_empty() {
        scenes = parse_scene_times(&String::from_utf8_lossy(&output.stderr));
    }
    Ok(scenes)
}

/// Parses the `pts_time:` values FFmpeg's metadata filter prints.
pub fn parse_scene_times(output: &str) -> Vec<f64> {
    let mut times: Vec<f64> = output
        .lines()
        .filter_map(|line| {
            let index = line.find("pts_time:")?;
            line[index + "pts_time:".len()..]
                .split_whitespace()
                .next()?
                .parse::<f64>()
                .ok()
        })
        .filter(|time| *time > 0.0)
        .collect();

    times.sort_by(f64::total_cmp);
    times.dedup_by(|a, b| (*a - *b).abs() < 1e-3);
    times
}

/// Turns boundaries into [start, end) shot ranges covering the whole file.
pub fn shots(scenes: &[f64], duration: f64) -> Vec<(f64, f64)> {
    let mut bounds = vec![0.0];
    bounds.extend(scenes.iter().copied().filter(|t| *t > 0.0 && *t < duration));
    bounds.push(duration);

    bounds
        .windows(2)
        .filter(|pair| pair[1] > pair[0])
        .map(|pair| (pair[0], pair[1]))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const OUTPUT: &str = "\
frame:0    pts:0       pts_time:0
lavfi.scene_score=0.000000
frame:1    pts:120     pts_time:4.004
lavfi.scene_score=0.812345
frame:2    pts:300     pts_time:10.01
lavfi.scene_score=0.500000
";

    #[test]
    fn parses_scene_boundaries() {
        let times = parse_scene_times(OUTPUT);
        assert_eq!(times.len(), 2);
        assert!((times[0] - 4.004).abs() < 1e-6);
        assert!((times[1] - 10.01).abs() < 1e-6);
    }

    #[test]
    fn drops_the_zero_boundary_since_every_file_starts_at_zero() {
        assert!(!parse_scene_times(OUTPUT).contains(&0.0));
    }

    #[test]
    fn deduplicates_boundaries_reported_twice() {
        let output = "pts_time:5.0\npts_time:5.0005\npts_time:9.0";
        assert_eq!(parse_scene_times(output).len(), 2);
    }

    #[test]
    fn ignores_output_without_timestamps() {
        assert!(parse_scene_times("frame= 100 fps=25").is_empty());
    }

    #[test]
    fn shots_cover_the_whole_file() {
        let ranges = shots(&[4.0, 10.0], 15.0);
        assert_eq!(ranges, vec![(0.0, 4.0), (4.0, 10.0), (10.0, 15.0)]);
    }

    #[test]
    fn a_file_with_no_cuts_is_a_single_shot() {
        assert_eq!(shots(&[], 12.0), vec![(0.0, 12.0)]);
    }

    #[test]
    fn boundaries_beyond_the_duration_are_ignored() {
        assert_eq!(shots(&[20.0], 10.0), vec![(0.0, 10.0)]);
    }
}
