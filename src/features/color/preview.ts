/** Approximate color preview in the browser.
 *
 * The CSS filter is a fast stand-in for the preview monitor only. Export always
 * goes through the FFmpeg filter graph built in the Rust core, so what the user
 * sees here is an approximation of the final grade, not the grade itself.
 */

import type { ColorSettings } from "@/types/color";
import { DEFAULT_COLOR, isDefaultColor } from "@/types/color";

export function colorToCssFilter(color: ColorSettings): string | undefined {
  if (isDefaultColor(color)) return undefined;

  const brightness = 1 + color.exposure / 100;
  const contrast = 1 + color.contrast / 100;
  const saturate = color.saturation / DEFAULT_COLOR.saturation;
  // Temperature is approximated with a hue rotation: warm shifts towards red.
  const hueRotate = -color.temperature * 0.15 + color.tint * 0.1;

  return [
    `brightness(${brightness.toFixed(3)})`,
    `contrast(${contrast.toFixed(3)})`,
    `saturate(${saturate.toFixed(3)})`,
    `hue-rotate(${hueRotate.toFixed(2)}deg)`,
  ].join(" ");
}
