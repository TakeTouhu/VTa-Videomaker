//! Caption rendering via FFmpeg's drawtext filter (design doc section 58).
//!
//! Each cue becomes one drawtext stage gated to its own time range. Text is
//! escaped for the filter-graph syntax, which is the part that silently breaks
//! a render if it is not handled.

use crate::timeline::{CaptionStyle, CaptionTrack};

/// Escapes text for use inside a filter-graph argument.
///
/// FFmpeg parses the graph in two passes, so backslashes, colons, quotes,
/// commas, brackets and semicolons all need escaping - a caption containing a
/// colon breaks the whole graph otherwise.
pub fn escape_drawtext(text: &str) -> String {
    let mut escaped = String::with_capacity(text.len() + 8);
    for character in text.chars() {
        match character {
            '\\' => escaped.push_str("\\\\\\\\"),
            ':' => escaped.push_str("\\\\:"),
            '\'' => escaped.push_str("\\\\\\'"),
            '%' => escaped.push_str("\\\\%"),
            ',' => escaped.push_str("\\,"),
            '[' => escaped.push_str("\\["),
            ']' => escaped.push_str("\\]"),
            ';' => escaped.push_str(r"\;"),
            '\n' => escaped.push_str("\\n"),
            other => escaped.push(other),
        }
    }
    escaped
}

/// `#RRGGBB` or `#RRGGBBAA` to FFmpeg's `0xRRGGBB@alpha` form.
pub fn to_ffmpeg_color(color: &str) -> String {
    let hex = color.trim_start_matches('#');
    if hex.len() == 8 {
        let alpha = u8::from_str_radix(&hex[6..8], 16).unwrap_or(255);
        format!("0x{}@{:.3}", &hex[0..6], alpha as f64 / 255.0)
    } else if hex.len() == 6 {
        format!("0x{hex}")
    } else {
        "white".to_string()
    }
}

fn x_expression(style: &CaptionStyle) -> &'static str {
    match style.alignment.as_str() {
        "left" => "(w*0.05)",
        "right" => "(w*0.95-text_w)",
        _ => "(w-text_w)/2",
    }
}

/// Builds the drawtext stages for one caption track.
///
/// Returns None when the track is disabled or empty, so a caption track that is
/// switched off costs nothing at render time.
pub fn caption_filters(track: &CaptionTrack, frame_height: u32) -> Option<String> {
    if !track.enabled || track.cues.is_empty() {
        return None;
    }

    let style = &track.style;
    let y = (frame_height as f64 * style.position_y).round() as i64;
    let font_color = to_ffmpeg_color(&style.color);
    let outline = to_ffmpeg_color(&style.outline_color);

    let stages: Vec<String> = track
        .cues
        .iter()
        .filter(|cue| cue.end > cue.start && !cue.text.trim().is_empty())
        .map(|cue| {
            let mut parts = vec![
                format!("text='{}'", escape_drawtext(&cue.text)),
                format!("fontsize={}", style.font_size),
                format!("fontcolor={font_color}"),
                format!("x={}", x_expression(style)),
                format!("y={y}"),
                format!("borderw={}", style.outline_width),
                format!("bordercolor={outline}"),
                "line_spacing=6".to_string(),
                format!("enable='between(t,{:.4},{:.4})'", cue.start, cue.end),
            ];

            if !style.background_color.is_empty() {
                parts.push("box=1".to_string());
                parts.push(format!(
                    "boxcolor={}",
                    to_ffmpeg_color(&style.background_color)
                ));
                parts.push("boxborderw=12".to_string());
            }
            if !style.font_family.is_empty() {
                parts.push(format!("font='{}'", escape_drawtext(&style.font_family)));
            }

            format!("drawtext={}", parts.join(":"))
        })
        .collect();

    if stages.is_empty() {
        return None;
    }
    Some(stages.join(","))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::timeline::CaptionCue;

    fn style() -> CaptionStyle {
        CaptionStyle {
            font_family: "Noto Sans JP".into(),
            font_size: 42,
            color: "#FFFFFF".into(),
            background_color: "#000000A0".into(),
            outline_color: "#000000".into(),
            outline_width: 2,
            position_y: 0.86,
            alignment: "center".into(),
            bold: true,
        }
    }

    fn track(cues: Vec<CaptionCue>) -> CaptionTrack {
        CaptionTrack {
            id: "ct1".into(),
            name: "Captions".into(),
            enabled: true,
            style: style(),
            cues,
        }
    }

    fn cue(start: f64, end: f64, text: &str) -> CaptionCue {
        CaptionCue {
            id: "c".into(),
            start,
            end,
            text: text.into(),
        }
    }

    #[test]
    fn builds_one_stage_per_cue() {
        let filters = caption_filters(
            &track(vec![
                cue(0.0, 2.0, "こんにちは"),
                cue(2.0, 4.0, "さようなら"),
            ]),
            1080,
        )
        .unwrap();
        assert_eq!(filters.matches("drawtext=").count(), 2);
    }

    #[test]
    fn gates_each_cue_to_its_time_range() {
        let filters = caption_filters(&track(vec![cue(1.5, 3.25, "hi")]), 1080).unwrap();
        assert!(
            filters.contains("enable='between(t,1.5000,3.2500)'"),
            "{filters}"
        );
    }

    #[test]
    fn a_disabled_track_renders_nothing() {
        let mut disabled = track(vec![cue(0.0, 1.0, "hi")]);
        disabled.enabled = false;
        assert!(caption_filters(&disabled, 1080).is_none());
    }

    #[test]
    fn an_empty_track_renders_nothing() {
        assert!(caption_filters(&track(vec![]), 1080).is_none());
    }

    #[test]
    fn skips_a_cue_that_ends_before_it_starts() {
        assert!(caption_filters(&track(vec![cue(5.0, 2.0, "hi")]), 1080).is_none());
    }

    #[test]
    fn escapes_a_colon_that_would_break_the_filter_graph() {
        let escaped = escape_drawtext("12:34 です");
        assert!(escaped.contains("\\\\:"), "{escaped}");
    }

    #[test]
    fn escapes_quotes_commas_and_brackets() {
        let escaped = escape_drawtext("it's [a, b];");
        assert!(!escaped.contains("s'["), "{escaped}");
        assert!(escaped.contains("\\,"));
        assert!(escaped.contains("\\["));
        assert!(escaped.contains(r"\;"));
    }

    #[test]
    fn converts_colours_including_alpha() {
        assert_eq!(to_ffmpeg_color("#FFFFFF"), "0xFFFFFF");
        assert_eq!(to_ffmpeg_color("#000000A0"), "0x000000@0.627");
    }

    #[test]
    fn falls_back_for_an_unparseable_colour() {
        assert_eq!(to_ffmpeg_color("red"), "white");
    }

    #[test]
    fn alignment_changes_the_x_expression() {
        let mut left = style();
        left.alignment = "left".into();
        assert_eq!(x_expression(&left), "(w*0.05)");

        let mut right = style();
        right.alignment = "right".into();
        assert_eq!(x_expression(&right), "(w*0.95-text_w)");
    }
}
