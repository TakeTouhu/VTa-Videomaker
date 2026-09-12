//! Effect, mask and transition filters (design doc sections 17, 58).

use crate::timeline::{Effect, Mask, MaskShape, Transition};

/* ------------------------------------------------------------------ */
/* Effects                                                             */
/* ------------------------------------------------------------------ */

fn number(effect: &Effect, key: &str, fallback: f64) -> f64 {
    effect
        .parameters
        .get(key)
        .and_then(|value| value.as_f64())
        .unwrap_or(fallback)
}

fn text(effect: &Effect, key: &str) -> Option<String> {
    effect
        .parameters
        .get(key)
        .and_then(|value| value.as_str())
        .map(str::to_string)
        .filter(|value| !value.is_empty())
}

/// Builds the FFmpeg stage for one effect, or None when it does nothing.
pub fn effect_filter(effect: &Effect) -> Option<String> {
    if !effect.enabled {
        return None;
    }

    match effect.effect_type.as_str() {
        "blur" => {
            let amount = number(effect, "amount", 0.0);
            (amount > 0.0).then(|| format!("gblur=sigma={amount:.3}"))
        }
        "sharpen" => {
            let amount = number(effect, "amount", 0.0);
            (amount > 0.0).then(|| format!("unsharp=5:5:{amount:.3}:5:5:0"))
        }
        "denoise" => {
            let amount = number(effect, "amount", 0.0);
            (amount > 0.0).then(|| format!("hqdn3d={amount:.2}:{:.2}:6:6", amount * 0.75))
        }
        "vignette" => {
            let amount = number(effect, "amount", 0.0);
            // The filter takes an angle: more amount means a tighter corner.
            (amount > 0.0).then(|| {
                let angle = 1.0 - (amount / 100.0) * 0.6;
                format!("vignette=angle=PI/{:.3}", 5.0 * angle)
            })
        }
        "glow" => {
            let amount = number(effect, "amount", 0.0);
            (amount > 0.0).then(|| {
                // Bloom: a blurred copy screened back over the original.
                let sigma = 2.0 + amount / 10.0;
                format!(
                    "split[glowa][glowb];[glowb]gblur=sigma={sigma:.2}[glowblur];\
                     [glowa][glowblur]blend=all_mode=screen:all_opacity={:.3}",
                    (amount / 100.0).clamp(0.0, 1.0)
                )
            })
        }
        "blackAndWhite" => Some("hue=s=0".to_string()),
        "pixelate" => {
            let size = number(effect, "size", 0.0).max(2.0);
            Some(format!(
                "scale=iw/{size:.0}:ih/{size:.0}:flags=neighbor,scale=iw*{size:.0}:ih*{size:.0}:flags=neighbor"
            ))
        }
        "chromaKey" => {
            let color = text(effect, "color").unwrap_or_else(|| "#00FF00".into());
            let similarity = (number(effect, "similarity", 25.0) / 100.0).clamp(0.01, 1.0);
            let blend = (number(effect, "blend", 10.0) / 100.0).clamp(0.0, 1.0);
            Some(format!(
                "chromakey={}:{similarity:.3}:{blend:.3}",
                super::captions::to_ffmpeg_color(&color)
            ))
        }
        "lut" => {
            let path = text(effect, "path")?;
            // Escaped because a Windows path contains backslashes and a colon.
            Some(format!("lut3d=file='{}'", escape_path(&path)))
        }
        _ => None,
    }
}

/// Escapes a filesystem path for use inside a filter-graph argument.
pub fn escape_path(path: &str) -> String {
    path.replace('\\', "/").replace(':', "\\\\:")
}

/// Chains every enabled effect on a clip.
pub fn effect_chain(effects: &[Effect]) -> Option<String> {
    let stages: Vec<String> = effects.iter().filter_map(effect_filter).collect();
    (!stages.is_empty()).then(|| stages.join(","))
}

/* ------------------------------------------------------------------ */
/* Masks                                                               */
/* ------------------------------------------------------------------ */

/// Builds a `geq` alpha expression selecting the masked region.
///
/// Coordinates are normalised, so the expression is written against `W` and `H`
/// and stays correct at any output resolution. Feathering is a linear ramp
/// outside the shape edge.
pub fn mask_alpha_expression(mask: &Mask) -> Option<String> {
    if !mask.enabled {
        return None;
    }

    let feather = mask.feather.max(0.0001);
    let expansion = mask.expansion;
    let opacity = mask.opacity.clamp(0.0, 1.0);

    // `d` is the signed distance to the shape edge, negative inside.
    let distance = match &mask.shape {
        MaskShape::Rectangle {
            x,
            y,
            width,
            height,
            ..
        } => {
            let cx = x + width / 2.0;
            let cy = y + height / 2.0;
            let hw = width / 2.0 + expansion;
            let hh = height / 2.0 + expansion;
            format!("max(abs(X/W-{cx:.5})-{hw:.5},abs(Y/H-{cy:.5})-{hh:.5})")
        }
        MaskShape::Ellipse {
            x,
            y,
            radius_x,
            radius_y,
            ..
        } => {
            let rx = (radius_x + expansion).max(0.0001);
            let ry = (radius_y + expansion).max(0.0001);
            format!("(hypot((X/W-{x:.5})/{rx:.5},(Y/H-{y:.5})/{ry:.5})-1)*{rx:.5}")
        }
        MaskShape::Polygon { points } => {
            // A polygon is approximated by its bounding box: an exact
            // point-in-polygon test is not expressible in geq for an arbitrary
            // point count. The UI says so when a polygon mask is exported.
            if points.is_empty() {
                return None;
            }
            let min_x = points.iter().map(|p| p.x).fold(f64::MAX, f64::min);
            let max_x = points.iter().map(|p| p.x).fold(f64::MIN, f64::max);
            let min_y = points.iter().map(|p| p.y).fold(f64::MAX, f64::min);
            let max_y = points.iter().map(|p| p.y).fold(f64::MIN, f64::max);

            let cx = (min_x + max_x) / 2.0;
            let cy = (min_y + max_y) / 2.0;
            let hw = (max_x - min_x) / 2.0 + expansion;
            let hh = (max_y - min_y) / 2.0 + expansion;
            format!("max(abs(X/W-{cx:.5})-{hw:.5},abs(Y/H-{cy:.5})-{hh:.5})")
        }
    };

    // Inside -> 1, outside -> 0, with a feathered ramp between.
    let ramp = format!("clip(0.5-({distance})/{feather:.5},0,1)");
    let shaped = if mask.inverted {
        format!("(1-({ramp}))")
    } else {
        ramp
    };

    Some(format!("({shaped})*{opacity:.4}"))
}

/// Applies a graded copy of the input only inside the mask.
///
/// The input is split, the graded branch is limited by the mask's alpha, and
/// the two are recombined, so a mask affects only the effect, not the picture.
pub fn masked_stage(inner: &str, mask: &Mask, label: &str) -> Option<String> {
    let alpha = mask_alpha_expression(mask)?;
    Some(format!(
        "split[{label}base][{label}fx];\
         [{label}fx]{inner},format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='255*({alpha})'[{label}masked];\
         [{label}base][{label}masked]overlay=format=auto"
    ))
}

/* ------------------------------------------------------------------ */
/* Transitions                                                         */
/* ------------------------------------------------------------------ */

/// Maps a transition type onto FFmpeg's xfade transition names.
pub fn xfade_name(transition_type: &str) -> &'static str {
    match transition_type {
        "fadeToBlack" => "fadeblack",
        "fadeToWhite" => "fadewhite",
        "wipeLeft" => "wipeleft",
        "wipeRight" => "wiperight",
        "slideUp" => "slideup",
        "slideDown" => "slidedown",
        "circleOpen" => "circleopen",
        // Cross dissolve is the default and the safest fallback.
        _ => "fade",
    }
}

/// Builds the xfade stage for a transition at `offset` seconds.
pub fn transition_filter(transition: &Transition, offset: f64) -> String {
    format!(
        "xfade=transition={}:duration={:.4}:offset={offset:.4}",
        xfade_name(&transition.transition_type),
        transition.duration.max(0.01)
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::timeline::{MaskPoint, Transition};
    use serde_json::json;

    fn effect(effect_type: &str, parameters: serde_json::Value) -> Effect {
        Effect {
            id: "e1".into(),
            effect_type: effect_type.into(),
            enabled: true,
            parameters: parameters.as_object().unwrap().clone(),
        }
    }

    fn mask(shape: MaskShape) -> Mask {
        Mask {
            id: "m1".into(),
            name: "Mask".into(),
            shape,
            feather: 0.02,
            expansion: 0.0,
            opacity: 1.0,
            inverted: false,
            enabled: true,
            track: vec![],
        }
    }

    #[test]
    fn builds_a_blur_stage() {
        let filter = effect_filter(&effect("blur", json!({ "amount": 8 }))).unwrap();
        assert_eq!(filter, "gblur=sigma=8.000");
    }

    #[test]
    fn a_zero_amount_effect_adds_nothing() {
        assert!(effect_filter(&effect("blur", json!({ "amount": 0 }))).is_none());
    }

    #[test]
    fn a_disabled_effect_adds_nothing() {
        let mut disabled = effect("blur", json!({ "amount": 8 }));
        disabled.enabled = false;
        assert!(effect_filter(&disabled).is_none());
    }

    #[test]
    fn an_unknown_effect_is_ignored_rather_than_breaking_the_graph() {
        assert!(effect_filter(&effect("teleport", json!({}))).is_none());
    }

    #[test]
    fn chains_several_effects_in_order() {
        let chain = effect_chain(&[
            effect("blur", json!({ "amount": 2 })),
            effect("blackAndWhite", json!({})),
        ])
        .unwrap();
        assert_eq!(chain, "gblur=sigma=2.000,hue=s=0");
    }

    #[test]
    fn a_lut_without_a_path_is_skipped() {
        assert!(effect_filter(&effect("lut", json!({ "path": "" }))).is_none());
    }

    #[test]
    fn escapes_a_windows_lut_path() {
        let filter =
            effect_filter(&effect("lut", json!({ "path": "C:\\luts\\film.cube" }))).unwrap();
        assert!(filter.contains("C\\\\:/luts/film.cube"), "{filter}");
    }

    #[test]
    fn a_rectangle_mask_produces_a_bounded_alpha_expression() {
        let expression = mask_alpha_expression(&mask(MaskShape::Rectangle {
            x: 0.25,
            y: 0.25,
            width: 0.5,
            height: 0.5,
            rotation: 0.0,
            corner_radius: 0.0,
        }))
        .unwrap();
        assert!(expression.contains("clip("), "{expression}");
        assert!(expression.contains("X/W"), "{expression}");
    }

    #[test]
    fn an_ellipse_mask_uses_a_radial_distance() {
        let expression = mask_alpha_expression(&mask(MaskShape::Ellipse {
            x: 0.5,
            y: 0.5,
            radius_x: 0.25,
            radius_y: 0.2,
            rotation: 0.0,
        }))
        .unwrap();
        assert!(expression.contains("hypot("), "{expression}");
    }

    #[test]
    fn an_inverted_mask_flips_the_ramp() {
        let mut inverted = mask(MaskShape::Ellipse {
            x: 0.5,
            y: 0.5,
            radius_x: 0.25,
            radius_y: 0.25,
            rotation: 0.0,
        });
        inverted.inverted = true;
        let expression = mask_alpha_expression(&inverted).unwrap();
        assert!(expression.starts_with("((1-("), "{expression}");
    }

    #[test]
    fn a_disabled_mask_produces_nothing() {
        let mut disabled = mask(MaskShape::Rectangle {
            x: 0.0,
            y: 0.0,
            width: 1.0,
            height: 1.0,
            rotation: 0.0,
            corner_radius: 0.0,
        });
        disabled.enabled = false;
        assert!(mask_alpha_expression(&disabled).is_none());
    }

    #[test]
    fn an_empty_polygon_produces_nothing() {
        assert!(mask_alpha_expression(&mask(MaskShape::Polygon { points: vec![] })).is_none());
    }

    #[test]
    fn a_polygon_falls_back_to_its_bounding_box() {
        let expression = mask_alpha_expression(&mask(MaskShape::Polygon {
            points: vec![
                MaskPoint { x: 0.2, y: 0.2 },
                MaskPoint { x: 0.8, y: 0.3 },
                MaskPoint { x: 0.5, y: 0.9 },
            ],
        }))
        .unwrap();
        assert!(expression.contains("abs(X/W-0.50000)"), "{expression}");
    }

    #[test]
    fn a_masked_stage_recombines_with_the_original() {
        let stage = masked_stage(
            "gblur=sigma=5",
            &mask(MaskShape::Rectangle {
                x: 0.1,
                y: 0.1,
                width: 0.2,
                height: 0.2,
                rotation: 0.0,
                corner_radius: 0.0,
            }),
            "m0",
        )
        .unwrap();
        assert!(stage.contains("split[m0base][m0fx]"), "{stage}");
        assert!(stage.contains("overlay=format=auto"), "{stage}");
    }

    #[test]
    fn maps_transition_names_onto_xfade() {
        assert_eq!(xfade_name("crossDissolve"), "fade");
        assert_eq!(xfade_name("wipeLeft"), "wipeleft");
        assert_eq!(xfade_name("circleOpen"), "circleopen");
        // Anything unrecognised degrades to a cross dissolve, never an error.
        assert_eq!(xfade_name("sparkle"), "fade");
    }

    #[test]
    fn builds_a_transition_stage() {
        let transition = Transition {
            id: "t1".into(),
            track_id: "v1".into(),
            from_clip_id: "a".into(),
            to_clip_id: "b".into(),
            transition_type: "wipeLeft".into(),
            duration: 1.5,
        };
        let filter = transition_filter(&transition, 4.0);
        assert_eq!(
            filter,
            "xfade=transition=wipeleft:duration=1.5000:offset=4.0000"
        );
    }
}
