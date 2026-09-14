/** Combines a clip's own grade with the adjustment layers above it.
 *
 * Adjustment layers apply to everything beneath them (design doc section 16).
 * The preview needs a single resolved ColorSettings; export applies the same
 * ordering as separate FFmpeg filter stages.
 */

import type { Clip } from "@/types/timeline";
import type { ColorSettings, CurveSettings } from "@/types/color";
import { BASIC_COLOR_KEYS, DEFAULT_COLOR, hasCurveAdjustment } from "@/types/color";

/**
 * Additive for the offset-style parameters (exposure, contrast, ...) and
 * multiplicative for saturation, which is a percentage rather than an offset.
 */
export function mergeColorStack(
  base: ColorSettings,
  adjustments: Clip[],
): ColorSettings {
  if (adjustments.length === 0) return base;

  const result: ColorSettings = { ...base };
  let curves: CurveSettings | undefined = base.curves;

  for (const layer of adjustments) {
    for (const key of BASIC_COLOR_KEYS) {
      if (key === "saturation") {
        result.saturation =
          (result.saturation * layer.color.saturation) / DEFAULT_COLOR.saturation;
        continue;
      }
      result[key] += layer.color[key] - DEFAULT_COLOR[key];
    }
    // Curves do not compose meaningfully by averaging, so the topmost layer
    // that defines one wins; the preview says so in the Inspector note.
    if (hasCurveAdjustment(layer.color.curves)) {
      curves = layer.color.curves;
    }
  }

  result.curves = curves;
  return result;
}
