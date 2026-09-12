//! Builds the FFmpeg filter graph for a sequence.
//!
//! Each clip becomes a trimmed, speed-adjusted, colour-graded segment; segments
//! on a track are concatenated over a black base of the full sequence length,
//! then tracks are stacked bottom to top. Audio tracks are mixed with amix.

use crate::error::{CoreError, CoreResult};
use crate::ffmpeg::filters;
use crate::render::captions;
use crate::render::ExportSettings;
use crate::timeline::{Clip, Sequence};
use std::collections::HashMap;
use std::path::PathBuf;

pub struct RenderPlan {
    pub args: Vec<String>,
    /// The filter_complex string, exposed for tests and the ffmpeg log.
    pub filter_complex: String,
}

pub fn build(
    sequence: &Sequence,
    settings: &ExportSettings,
    media_paths: &HashMap<String, PathBuf>,
) -> CoreResult<RenderPlan> {
    let mut args: Vec<String> = vec!["-y".into()];
    let mut filters_parts: Vec<String> = Vec::new();
    let duration = sequence.duration();

    // Input 0 is a black canvas so gaps and empty tracks stay well defined.
    args.push("-f".into());
    args.push("lavfi".into());
    args.push("-t".into());
    args.push(format!("{duration:.4}"));
    args.push("-i".into());
    args.push(format!(
        "color=c=black:s={}x{}:r={}",
        settings.width, settings.height, settings.fps
    ));

    // Input 1 is silence, for the same reason on the audio side.
    args.push("-f".into());
    args.push("lavfi".into());
    args.push("-t".into());
    args.push(format!("{duration:.4}"));
    args.push("-i".into());
    args.push("anullsrc=channel_layout=stereo:sample_rate=48000".into());

    let mut input_index = 2usize;
    let mut video_layers: Vec<String> = vec!["[0:v]".into()];
    let mut audio_layers: Vec<String> = vec!["[1:a]".into()];

    let audible: Vec<String> = sequence
        .audible_audio_tracks()
        .iter()
        .map(|track| track.id.clone())
        .collect();

    for clip in &sequence.clips {
        let Some(media_id) = clip.media_id.as_ref() else {
            // Adjustment layers carry no source media; they are applied to the
            // layers underneath and are handled once masks land in Phase 5.
            continue;
        };
        let path = media_paths
            .get(media_id)
            .ok_or_else(|| CoreError::Render(format!("missing media path for {media_id}")))?;

        let on_video_track = sequence
            .video_tracks
            .iter()
            .any(|track| track.id == clip.track_id && !track.hidden);
        let on_audio_track = audible.contains(&clip.track_id);
        if !on_video_track && !on_audio_track {
            continue;
        }

        args.push("-i".into());
        args.push(path.display().to_string());

        if on_video_track {
            let label = format!("v{input_index}");
            filters_parts.push(video_segment(clip, input_index, &label, settings));
            video_layers.push(format!("[{label}]"));
        }
        if on_audio_track {
            if let Some(audio) = &clip.audio {
                if !audio.muted {
                    let label = format!("a{input_index}");
                    filters_parts.push(audio_segment(clip, input_index, &label));
                    audio_layers.push(format!("[{label}]"));
                }
            }
        }
        input_index += 1;
    }

    // Composite video: overlay each segment at its timeline position.
    let mut current = video_layers[0].clone();
    for (index, layer) in video_layers.iter().enumerate().skip(1) {
        let output = format!("[vtmp{index}]");
        filters_parts.push(format!(
            "{current}{layer}overlay=x=0:y=0:eof_action=pass{output}"
        ));
        current = output;
    }
    if video_layers.len() == 1 {
        filters_parts.push(format!("{current}null[vbase]"));
        current = "[vbase]".to_string();
    }

    // Adjustment layers grade the composite beneath them, limited to their own
    // time range via the filters' `enable` expression (design doc section 16).
    for (index, layer) in sequence.adjustment_layers().iter().enumerate() {
        let Some(stages) = adjustment_stages(layer) else {
            continue;
        };
        let output = format!("[vadj{index}]");
        filters_parts.push(format!("{current}{stages}{output}"));
        current = output;
    }

    // Captions are drawn last, over everything (design doc section 58).
    for (index, track) in sequence.caption_tracks.iter().enumerate() {
        let Some(stages) = captions::caption_filters(track, settings.height) else {
            continue;
        };
        let output = format!("[vcap{index}]");
        filters_parts.push(format!("{current}{stages}{output}"));
        current = output;
    }

    filters_parts.push(format!("{current}null[vout]"));

    // Mix audio.
    if audio_layers.len() == 1 {
        filters_parts.push(format!("{}anull[aout]", audio_layers[0]));
    } else {
        filters_parts.push(format!(
            "{}amix=inputs={}:normalize=0[aout]",
            audio_layers.join(""),
            audio_layers.len()
        ));
    }

    let filter_complex = filters_parts.join(";");
    args.push("-filter_complex".into());
    args.push(filter_complex.clone());
    args.push("-map".into());
    args.push("[vout]".into());
    args.push("-map".into());
    args.push("[aout]".into());

    args.push("-c:v".into());
    args.push(settings.encoder().into());
    args.push("-b:v".into());
    args.push(format!("{}k", settings.video_bitrate()));
    args.push("-pix_fmt".into());
    args.push("yuv420p".into());
    args.push("-r".into());
    args.push(format!("{}", settings.fps));
    args.push("-c:a".into());
    args.push("aac".into());
    args.push("-b:a".into());
    args.push(format!("{}k", settings.audio_bitrate_kbps));
    args.push("-t".into());
    args.push(format!("{duration:.4}"));
    args.push(settings.output_path.clone());

    Ok(RenderPlan {
        args,
        filter_complex,
    })
}

/// Colour stages for an adjustment layer, gated to the layer's time range.
///
/// Returns None when the layer changes nothing, so an inert layer costs nothing
/// at render time.
fn adjustment_stages(layer: &Clip) -> Option<String> {
    let color = filters::color_filter(&layer.color)?;
    let start = layer.start_time;
    let end = layer.end_time();

    // `enable` is evaluated per frame, so the grade applies only underneath the
    // layer rather than to the whole timeline.
    let gated: Vec<String> = color
        .split(',')
        .map(|stage| format!("{stage}:enable='between(t,{start:.4},{end:.4})'"))
        .collect();

    Some(gated.join(","))
}

/// trim -> speed -> colour -> scale -> position on the timeline.
fn video_segment(clip: &Clip, input: usize, label: &str, settings: &ExportSettings) -> String {
    let (speed_video, _) = filters::speed_filters(clip.speed);
    let mut stages = vec![
        format!(
            "trim=start={:.4}:end={:.4}",
            clip.source_in, clip.source_out
        ),
        "setpts=PTS-STARTPTS".to_string(),
        speed_video,
    ];

    if let Some(color) = filters::color_filter(&clip.color) {
        stages.push(color);
    }

    let scale = clip.transform.scale / 100.0;
    stages.push(format!(
        "scale={}:{}",
        (settings.width as f64 * scale).round() as i64,
        (settings.height as f64 * scale).round() as i64
    ));

    if clip.transform.opacity < 100.0 {
        stages.push(format!(
            "format=yuva420p,colorchannelmixer=aa={:.4}",
            clip.transform.opacity / 100.0
        ));
    }

    // tpad shifts the segment to its start time on the timeline.
    if clip.start_time > 0.0 {
        stages.push(format!("tpad=start_duration={:.4}", clip.start_time));
    }

    format!("[{input}:v]{}[{label}]", stages.join(","))
}

fn audio_segment(clip: &Clip, input: usize, label: &str) -> String {
    let audio = clip.audio.as_ref();
    let (_, speed_audio) = filters::speed_filters(clip.speed);

    let mut stages = vec![
        format!(
            "atrim=start={:.4}:end={:.4}",
            clip.source_in, clip.source_out
        ),
        "asetpts=PTS-STARTPTS".to_string(),
        speed_audio,
    ];

    if let Some(audio) = audio {
        stages.push(filters::audio_filter(
            audio.volume,
            audio.fade_in,
            audio.fade_out,
            clip.duration(),
        ));
    }
    if clip.start_time > 0.0 {
        stages.push(format!(
            "adelay={}|{}",
            (clip.start_time * 1000.0).round() as i64,
            (clip.start_time * 1000.0).round() as i64
        ));
    }

    format!("[{input}:a]{}[{label}]", stages.join(","))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ffmpeg::filters::ColorSettings;
    use crate::timeline::{AudioSettings, AudioTrack, Transform, VideoTrack};

    fn settings() -> ExportSettings {
        ExportSettings {
            output_path: "out.mp4".into(),
            format: "mp4".into(),
            codec: "h264".into(),
            width: 1920,
            height: 1080,
            fps: 30.0,
            quality: "high".into(),
            bitrate_kbps: None,
            audio_bitrate_kbps: 192,
        }
    }

    fn sequence_with(clips: Vec<Clip>) -> Sequence {
        Sequence {
            id: "s".into(),
            name: "Sequence".into(),
            width: 1920,
            height: 1080,
            fps: 30.0,
            video_tracks: vec![VideoTrack {
                id: "v1".into(),
                name: "V1".into(),
                locked: false,
                hidden: false,
            }],
            audio_tracks: vec![AudioTrack {
                id: "a1".into(),
                name: "A1".into(),
                locked: false,
                muted: false,
                solo: false,
            }],
            clips,
            caption_tracks: vec![],
            playhead: 0.0,
        }
    }

    fn clip(track: &str, start: f64) -> Clip {
        Clip {
            id: "c1".into(),
            media_id: Some("m1".into()),
            track_id: track.into(),
            kind: "media".into(),
            start_time: start,
            source_in: 1.0,
            source_out: 3.0,
            speed: 1.0,
            transform: Transform {
                position_x: 0.0,
                position_y: 0.0,
                scale: 100.0,
                rotation: 0.0,
                opacity: 100.0,
            },
            color: ColorSettings::default(),
            audio: Some(AudioSettings {
                volume: 0.0,
                pan: 0.0,
                fade_in: 0.0,
                fade_out: 0.0,
                muted: false,
            }),
        }
    }

    fn paths() -> HashMap<String, PathBuf> {
        HashMap::from([("m1".to_string(), PathBuf::from("/tmp/a.mp4"))])
    }

    #[test]
    fn builds_a_graph_with_video_and_audio_outputs() {
        let sequence = sequence_with(vec![clip("v1", 0.0)]);
        let plan = build(&sequence, &settings(), &paths()).unwrap();
        assert!(
            plan.filter_complex.contains("[vout]"),
            "{}",
            plan.filter_complex
        );
        assert!(
            plan.filter_complex.contains("[aout]"),
            "{}",
            plan.filter_complex
        );
        assert!(plan.args.contains(&"-filter_complex".to_string()));
    }

    #[test]
    fn trims_to_the_clips_source_range() {
        let sequence = sequence_with(vec![clip("v1", 0.0)]);
        let plan = build(&sequence, &settings(), &paths()).unwrap();
        assert!(plan.filter_complex.contains("trim=start=1.0000:end=3.0000"));
    }

    #[test]
    fn offsets_a_clip_that_does_not_start_at_zero() {
        let sequence = sequence_with(vec![clip("v1", 5.0)]);
        let plan = build(&sequence, &settings(), &paths()).unwrap();
        assert!(plan.filter_complex.contains("tpad=start_duration=5.0000"));
    }

    #[test]
    fn hidden_tracks_are_excluded() {
        let mut sequence = sequence_with(vec![clip("v1", 0.0)]);
        sequence.video_tracks[0].hidden = true;
        let plan = build(&sequence, &settings(), &paths()).unwrap();
        assert!(!plan.filter_complex.contains("trim=start=1.0000"));
    }

    #[test]
    fn missing_media_path_is_an_error_not_a_broken_command() {
        let sequence = sequence_with(vec![clip("v1", 0.0)]);
        let result = build(&sequence, &settings(), &HashMap::new());
        assert!(result.is_err());
    }

    fn adjustment(track: &str, start: f64, end: f64, exposure: f64) -> Clip {
        let mut clip = clip(track, start);
        clip.id = "adj1".into();
        clip.media_id = None;
        clip.kind = "adjustment".into();
        clip.source_in = 0.0;
        clip.source_out = end - start;
        clip.audio = None;
        clip.color = ColorSettings {
            exposure,
            ..Default::default()
        };
        clip
    }

    #[test]
    fn an_adjustment_layer_grades_the_composite_beneath_it() {
        let sequence = sequence_with(vec![clip("v1", 0.0), adjustment("v1", 0.0, 2.0, 40.0)]);
        let plan = build(&sequence, &settings(), &paths()).unwrap();

        // The grade is applied after compositing, gated to the layer's range.
        assert!(
            plan.filter_complex.contains("[vadj0]"),
            "{}",
            plan.filter_complex
        );
        assert!(
            plan.filter_complex
                .contains("enable='between(t,0.0000,2.0000)'"),
            "{}",
            plan.filter_complex
        );
    }

    #[test]
    fn an_adjustment_layer_is_not_given_its_own_input() {
        let sequence = sequence_with(vec![clip("v1", 0.0), adjustment("v1", 0.0, 2.0, 40.0)]);
        let plan = build(&sequence, &settings(), &paths()).unwrap();
        // Two lavfi inputs plus exactly one media input.
        assert_eq!(plan.args.iter().filter(|arg| *arg == "-i").count(), 3);
    }

    #[test]
    fn an_inert_adjustment_layer_adds_no_filter() {
        let sequence = sequence_with(vec![clip("v1", 0.0), adjustment("v1", 0.0, 2.0, 0.0)]);
        let plan = build(&sequence, &settings(), &paths()).unwrap();
        assert!(!plan.filter_complex.contains("[vadj0]"));
    }

    #[test]
    fn the_graph_always_ends_at_vout() {
        let sequence = sequence_with(vec![clip("v1", 0.0), adjustment("v1", 0.0, 2.0, 40.0)]);
        let plan = build(&sequence, &settings(), &paths()).unwrap();
        // The video chain terminates at [vout]; the audio chain follows it.
        assert!(
            plan.filter_complex.contains("[vadj0]null[vout]"),
            "{}",
            plan.filter_complex
        );
        assert_eq!(plan.filter_complex.matches("[vout]").count(), 1);
    }

    #[test]
    fn h265_selects_the_right_encoder() {
        let mut export = settings();
        export.codec = "h265".into();
        assert_eq!(export.encoder(), "libx265");
    }
}
