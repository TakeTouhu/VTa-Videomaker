/** Per-clip color grading parameters (design doc section 31). */

export interface ColorSettings {
  exposure: number;
  contrast: number;
  highlights: number;
  shadows: number;
  whites: number;
  blacks: number;
  temperature: number;
  tint: number;
  saturation: number;
}

export const DEFAULT_COLOR: ColorSettings = {
  exposure: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
  temperature: 0,
  tint: 0,
  saturation: 100,
};

/** Inclusive UI ranges. The renderer clamps to these before building filters. */
export const COLOR_RANGES: Record<keyof ColorSettings, [number, number]> = {
  exposure: [-100, 100],
  contrast: [-100, 100],
  highlights: [-100, 100],
  shadows: [-100, 100],
  whites: [-100, 100],
  blacks: [-100, 100],
  temperature: [-100, 100],
  tint: [-100, 100],
  saturation: [0, 200],
};

export function isDefaultColor(color: ColorSettings): boolean {
  return (Object.keys(DEFAULT_COLOR) as (keyof ColorSettings)[]).every(
    (key) => color[key] === DEFAULT_COLOR[key],
  );
}
