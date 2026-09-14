/** Approximate color preview in the browser.
 *
 * The CSS filter is a fast stand-in for the preview monitor only. Export always
 * goes through the FFmpeg filter graph built in the Rust core, so what the user
 * sees here is an approximation of the final grade, not the grade itself.
 */

import type { ColorSettings, CurveSettings } from "@/types/color";
import { DEFAULT_COLOR, evaluateCurve, hasCurveAdjustment, isDefaultColor } from "@/types/color";

export function colorToCssFilter(color: ColorSettings): string | undefined {
  if (isDefaultColor(color)) return undefined;

  const brightness = 1 + color.exposure / 100;
  const contrast = 1 + color.contrast / 100;
  const saturate = color.saturation / DEFAULT_COLOR.saturation;
  // Temperature is approximated with a hue rotation: warm shifts towards red.
  const hueRotate = -color.temperature * 0.15 + color.tint * 0.1;

  const stages = [
    `brightness(${brightness.toFixed(3)})`,
    `contrast(${contrast.toFixed(3)})`,
    `saturate(${saturate.toFixed(3)})`,
    `hue-rotate(${hueRotate.toFixed(2)}deg)`,
  ];

  // Curves are approximated with an SVG transfer function referenced by url().
  if (hasCurveAdjustment(color.curves)) {
    stages.push(`url(#${curveFilterId(color.curves)})`);
  }
  return stages.join(" ");
}

/**
 * Stable id for the SVG filter element backing a curve. Identical curves share
 * one filter element, so switching between clips with the same grade does not
 * churn the DOM.
 */
export function curveFilterId(curves: CurveSettings | undefined): string {
  if (!curves) return "curve-linear";
  const key = JSON.stringify(curves);
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) | 0;
  }
  return `curve-${(hash >>> 0).toString(36)}`;
}

/** Number of samples in the generated transfer function table. */
export const CURVE_TABLE_SIZE = 33;

/** Samples a curve into the `tableValues` list an SVG feFuncX expects. */
export function curveTableValues(points: Parameters<typeof evaluateCurve>[0]): string {
  return Array.from({ length: CURVE_TABLE_SIZE }, (_, index) => {
    const x = index / (CURVE_TABLE_SIZE - 1);
    return evaluateCurve(points, x).toFixed(4);
  }).join(" ");
}
