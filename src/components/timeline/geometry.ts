/** Pixel <-> time conversions. Zoom is expressed in pixels per second. */

export function timeToX(time: number, zoom: number): number {
  return time * zoom;
}

export function xToTime(x: number, zoom: number): number {
  return zoom > 0 ? x / zoom : 0;
}

/** Snap threshold in seconds, constant in pixels so it feels the same at any zoom. */
export const SNAP_PIXELS = 8;

export function snapThresholdSeconds(zoom: number): number {
  return zoom > 0 ? SNAP_PIXELS / zoom : 0;
}

/** Chooses a ruler tick interval that keeps labels ~80px apart. */
export function rulerInterval(zoom: number): number {
  const candidates = [
    1 / 30, 1 / 10, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600,
  ];
  const target = 80 / Math.max(zoom, 0.0001);
  return candidates.find((value) => value >= target) ?? 3600;
}
