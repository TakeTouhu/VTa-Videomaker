/** Per-clip color grading parameters (design doc sections 15, 31). */

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
  /** Tone curves (section 15.2). Absent means an untouched, linear curve. */
  curves?: CurveSettings;
}

/** A curve control point in normalised 0..1 input/output space. */
export interface CurvePoint {
  x: number;
  y: number;
}

export type CurveChannel = "rgb" | "red" | "green" | "blue";

export type CurveSettings = Partial<Record<CurveChannel, CurvePoint[]>>;

/** The identity curve: input maps straight to output. */
export const LINEAR_CURVE: CurvePoint[] = [
  { x: 0, y: 0 },
  { x: 1, y: 1 },
];

export const CURVE_CHANNELS: CurveChannel[] = ["rgb", "red", "green", "blue"];

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
export const COLOR_RANGES: Record<
  Exclude<keyof ColorSettings, "curves">,
  [number, number]
> = {
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

export const BASIC_COLOR_KEYS = Object.keys(COLOR_RANGES) as Exclude<
  keyof ColorSettings,
  "curves"
>[];

/** True when a curve is the identity and therefore has no visible effect. */
export function isLinearCurve(points: CurvePoint[] | undefined): boolean {
  if (!points || points.length === 0) return true;
  return points.every((point) => Math.abs(point.x - point.y) < 1e-6);
}

export function hasCurveAdjustment(curves: CurveSettings | undefined): boolean {
  if (!curves) return false;
  return CURVE_CHANNELS.some((channel) => !isLinearCurve(curves[channel]));
}

export function isDefaultColor(color: ColorSettings): boolean {
  const basicIsDefault = BASIC_COLOR_KEYS.every(
    (key) => color[key] === DEFAULT_COLOR[key],
  );
  return basicIsDefault && !hasCurveAdjustment(color.curves);
}

/** Sorts points by input and clamps them into the unit square. */
export function normalizeCurve(points: CurvePoint[]): CurvePoint[] {
  return [...points]
    .map((point) => ({
      x: Math.min(1, Math.max(0, point.x)),
      y: Math.min(1, Math.max(0, point.y)),
    }))
    .sort((a, b) => a.x - b.x);
}

/**
 * Evaluates a curve at `x` with linear interpolation between control points.
 * Used by the preview to build a LUT; export uses FFmpeg's own curve filter.
 */
export function evaluateCurve(points: CurvePoint[], x: number): number {
  const sorted = normalizeCurve(points);
  if (sorted.length === 0) return x;

  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  if (x <= first.x) return first.y;
  if (x >= last.x) return last.y;

  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1]!;
    const current = sorted[index]!;
    if (x <= current.x) {
      const span = current.x - previous.x;
      if (span <= 0) return current.y;
      const t = (x - previous.x) / span;
      return previous.y + (current.y - previous.y) * t;
    }
  }
  return last.y;
}
