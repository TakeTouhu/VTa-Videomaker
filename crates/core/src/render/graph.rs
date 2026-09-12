//! Builds the FFmpeg filter graph for a sequence.
//!
//! Each clip becomes a trimmed, speed-adjusted, colour-graded segment; segments
//! on a track are concatenated over a black base of the full sequence length,
//! then tracks are stacked bottom to top. Audio tracks are mixed with amix.

use crate::error::{CoreError, CoreResult};
use crate::ffmpeg::filters;
use crate::render::captions;
use crate::render::effects as fx;
use crate::render::hardware;
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

    // Text clips are drawn over a transparent canvas rather than a media file.
    for clip in &sequence.clips {
        if !clip.is_text() {
            continue;
        }
        let on_visible_track = sequence
            .video_tracks
            .iter()
            .any(|track| track.id == clip.track_id && !track.hidden);
        if !on_visible_track {
            continue;
        }

        args.push("-f".into());
        args.push("lavfi".into());
        args.push("-t".into());
        args.push(format!("{:.4}", clip.duration()));
        args.push("-i".into());
        args.push(format!(
            "color=c=black@0:s={}x{}:r={}",
            settings.width, settings.height, settings.fps
        ));

        let label = format!("t{input_index}");
        filters_parts.push(text_segment(clip, input_index, &label, settings));
        video_layers.push(format!("[{label}]"));
        input_index += 1;
    }

    for clip in &sequence.clips {
        if clip.is_text() {
            continue;
        }
        let Some(media_id) = clip.media_id.as_ref() else {
            // Adjustment layers carry no source media; they grade the composite
            // beneath them after everything is overlaid.
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

    // Transitions are applied as a timed fade pair around each cut. A true
    // xfade needs the two clips as separate streams, which the overlay-based
    // compositor does not keep; fading around the cut gives the same result for
    // dissolves and fades, and the transition type is recorded either way.
    for (index, transition) in sequence.transitions.iter().enumerate() {
        let Some(from) = sequence
            .clips
            .iter()
            .find(|clip| clip.id == transition.from_clip_id)
        else {
            continue;
        };

        let cut = from.end_time();
        let half = (transition.duration / 2.0).max(0.01);
        let output = format!("[vtr{index}]");

        let stage = match transition.transition_type.as_str() {
            "fadeToBlack" | "crossDissolve" | "fadeToWhite" => {
                let color = if transition.transition_type == "fadeToWhite" {
                    "white"
                } else {
                    "black"
                };
                format!(
                    "fade=t=out:st={:.4}:d={half:.4}:color={color},                     fade=t=in:st={:.4}:d={half:.4}:color={color}",
                    cut - half,
                    cut
                )
            }
            // Wipes and slides need both streams side by side; until the
            // compositor keeps them, they render as a dissolve of the same
            // length rather than silently doing nothing.
            _ => format!(
                "fade=t=out:st={:.4}:d={half:.4},fade=t=in:st={:.4}:d={half:.4}",
                cut - half,
                cut
            ),
        };

        filters_parts.push(format!("{current}{stage}{output}"));
        current = output;
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

    // The encoder is resolved against what this machine actually offers, so a
    // GPU export on a machine without that GPU degrades to software.
    let acceleration = hardware::resolve(settings.hardware_acceleration, &hardware::available());

    args.push("-c:v".into());
    args.push(settings.encoder_for(acceleration));
    args.extend(hardware::quality_args(
        acceleration,
        settings.video_bitrate(),
    ));
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
    if let Some(chain) = fx::effect_chain(&clip.effects) {
        // A mask limits where the effects apply; without one they cover frame.
        match clip.masks.iter().find(|mask| mask.enabled) {
            Some(mask) => {
                if let Some(masked) = fx::masked_stage(&chain, mask, &format!("mk{input}")) {
                    stages.push(masked);
                } else {
                    stages.push(chain);
                }
            }
            None => stages.push(chain),
        }
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

/// Draws a text clip onto its transparent canvas and places it on the timeline.
fn text_segment(clip: &Clip, input: usize, label: &str, settings: &ExportSettings) -> String {
    let Some(text) = clip.text.as_ref() else {
        return format!("[{input}:v]null[{label}]");
    };

    let x = match text.alignment.as_str() {
        "left" => format!("{}", (settings.width as f64 * text.x).round() as i64),
        "right" => format!("{}-text_w", (settings.width as f64 * text.x).round() as i64),
        _ => format!(
            "{}-text_w/2",
            (settings.width as f64 * text.x).round() as i64
        ),
    };
    let y = (settings.height as f64 * text.y).round() as i64;

    let mut parts = vec![
        format!("text='{}'", captions::escape_drawtext(&text.content)),
        format!("fontsize={}", text.font_size),
        format!("fontcolor={}", captions::to_ffmpeg_color(&text.color)),
        format!("x={x}"),
        format!("y={y}-text_h/2"),
    ];
    if text.outline_width > 0 {
        parts.push(format!("borderw={}", text.outline_width));
        parts.push(format!(
            "bordercolor={}",
            captions::to_ffmpeg_color(&text.outline_color)
        ));
    }
    if !text.background_color.is_empty() {
        parts.push("box=1".to_string());
        parts.push(format!(
            "boxcolor={}",
            captions::to_ffmpeg_color(&text.background_color)
        ));
        parts.push("boxborderw=16".to_string());
    }
    if !text.font_family.is_empty() {
        parts.push(format!(
            "font='{}'",
            captions::escape_drawtext(&text.font_family)
        ));
    }

    let mut stages = vec![format!("drawtext={}", parts.join(":"))];
    if clip.transform.opacity < 100.0 {
        stages.push(format!(
            "colorchannelmixer=aa={:.4}",
            clip.transform.opacity / 100.0
        ));
    }
    if clip.start_time > 0.0 {
        stages.push(format!(
            "tpad=start_duration={:.4}:color=black@0",
            clip.start_time
        ));
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
            hardware_acceleration: hardware::Acceleration::None,
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
            transitions: vec![],
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
            masks: vec![],
            effects: vec![],
            keyframes: vec![],
            text: None,
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

    fn text_clip(track: &str, start: f64, content: &str) -> Clip {
        let mut clip = clip(track, start);
        clip.id = "txt1".into();
        clip.media_id = None;
        clip.kind = "text".into();
        clip.source_in = 0.0;
        clip.source_out = 3.0;
        clip.audio = None;
        clip.text = Some(crate::timeline::TextSettings {
            content: content.into(),
            font_family: "Noto Sans JP".into(),
            font_size: 64,
            color: "#FFFFFF".into(),
            background_color: String::new(),
            outline_color: "#000000".into(),
            outline_width: 2,
            bold: true,
            x: 0.5,
            y: 0.5,
            alignment: "center".into(),
        });
        clip
    }

    #[test]
    fn a_text_clip_gets_a_transparent_canvas_not_a_media_input() {
        let sequence = sequence_with(vec![text_clip("v1", 0.0, "タイトル")]);
        let plan = build(&sequence, &settings(), &HashMap::new()).unwrap();
        assert!(
            plan.filter_complex.contains("drawtext="),
            "{}",
            plan.filter_complex
        );
        assert!(plan.args.iter().any(|arg| arg.contains("color=c=black@0")));
    }

    #[test]
    fn a_text_clip_is_placed_at_its_start_time() {
        let sequence = sequence_with(vec![text_clip("v1", 4.0, "タイトル")]);
        let plan = build(&sequence, &settings(), &HashMap::new()).unwrap();
        assert!(
            plan.filter_complex
                .contains("tpad=start_duration=4.0000:color=black@0"),
            "{}",
            plan.filter_complex
        );
    }

    #[test]
    fn clip_effects_are_applied_after_colour() {
        let mut with_effect = clip("v1", 0.0);
        with_effect.effects = vec![crate::timeline::Effect {
            id: "e1".into(),
            effect_type: "blur".into(),
            enabled: true,
            parameters: serde_json::json!({ "amount": 4 })
                .as_object()
                .unwrap()
                .clone(),
        }];
        let sequence = sequence_with(vec![with_effect]);
        let plan = build(&sequence, &settings(), &paths()).unwrap();
        assert!(
            plan.filter_complex.contains("gblur=sigma=4.000"),
            "{}",
            plan.filter_complex
        );
    }

    #[test]
    fn a_mask_limits_where_an_effect_applies() {
        let mut with_mask = clip("v1", 0.0);
        with_mask.effects = vec![crate::timeline::Effect {
            id: "e1".into(),
            effect_type: "blur".into(),
            enabled: true,
            parameters: serde_json::json!({ "amount": 8 })
                .as_object()
                .unwrap()
                .clone(),
        }];
        with_mask.masks = vec![crate::timeline::Mask {
            id: "m1".into(),
            name: "顔".into(),
            shape: crate::timeline::MaskShape::Ellipse {
                x: 0.5,
                y: 0.4,
                radius_x: 0.15,
                radius_y: 0.2,
                rotation: 0.0,
            },
            feather: 0.03,
            expansion: 0.0,
            opacity: 1.0,
            inverted: false,
            enabled: true,
            track: vec![],
        }];

        let sequence = sequence_with(vec![with_mask]);
        let plan = build(&sequence, &settings(), &paths()).unwrap();
        // The blur runs on a split branch that is recombined through the mask.
        assert!(
            plan.filter_complex.contains("split[mk2base][mk2fx]"),
            "{}",
            plan.filter_complex
        );
        assert!(
            plan.filter_complex.contains("hypot("),
            "{}",
            plan.filter_complex
        );
    }

    #[test]
    fn a_transition_fades_around_the_cut() {
        let mut sequence = sequence_with(vec![clip("v1", 0.0)]);
        sequence.transitions = vec![crate::timeline::Transition {
            id: "t1".into(),
            track_id: "v1".into(),
            from_clip_id: "c1".into(),
            to_clip_id: "c2".into(),
            transition_type: "crossDissolve".into(),
            duration: 1.0,
        }];

        let plan = build(&sequence, &settings(), &paths()).unwrap();
        // The clip runs 0..2, so the cut is at 2.0 and the fade starts at 1.5.
        assert!(
            plan.filter_complex.contains("fade=t=out:st=1.5000"),
            "{}",
            plan.filter_complex
        );
        assert!(
            plan.filter_complex.contains("fade=t=in:st=2.0000"),
            "{}",
            plan.filter_complex
        );
    }

    #[test]
    fn a_transition_referring_to_a_missing_clip_is_skipped() {
        let mut sequence = sequence_with(vec![clip("v1", 0.0)]);
        sequence.transitions = vec![crate::timeline::Transition {
            id: "t1".into(),
            track_id: "v1".into(),
            from_clip_id: "ghost".into(),
            to_clip_id: "c2".into(),
            transition_type: "crossDissolve".into(),
            duration: 1.0,
        }];
        let plan = build(&sequence, &settings(), &paths()).unwrap();
        assert!(!plan.filter_complex.contains("[vtr0]"));
    }

    #[test]
    fn a_white_transition_fades_through_white() {
        let mut sequence = sequence_with(vec![clip("v1", 0.0)]);
        sequence.transitions = vec![crate::timeline::Transition {
            id: "t1".into(),
            track_id: "v1".into(),
            from_clip_id: "c1".into(),
            to_clip_id: "c2".into(),
            transition_type: "fadeToWhite".into(),
            duration: 1.0,
        }];
        let plan = build(&sequence, &settings(), &paths()).unwrap();
        assert!(
            plan.filter_complex.contains("color=white"),
            "{}",
            plan.filter_complex
        );
    }

    #[test]
    fn captions_are_drawn_over_the_composite() {
        let mut sequence = sequence_with(vec![clip("v1", 0.0)]);
        sequence.caption_tracks = vec![crate::timeline::CaptionTrack {
            id: "ct1".into(),
            name: "字幕".into(),
            enabled: true,
            style: crate::timeline::CaptionStyle {
                font_family: String::new(),
                font_size: 42,
                color: "#FFFFFF".into(),
                background_color: String::new(),
                outline_color: "#000000".into(),
                outline_width: 2,
                position_y: 0.86,
                alignment: "center".into(),
                bold: true,
            },
            cues: vec![crate::timeline::CaptionCue {
                id: "c1".into(),
                start: 0.0,
                end: 2.0,
                text: "こんにちは".into(),
            }],
        }];

        let plan = build(&sequence, &settings(), &paths()).unwrap();
        assert!(
            plan.filter_complex.contains("[vcap0]"),
            "{}",
            plan.filter_complex
        );
    }

    #[test]
    fn h265_selects_the_right_encoder() {
        let mut export = settings();
        export.codec = "h265".into();
        assert_eq!(export.encoder(), "libx265");
    }
}
