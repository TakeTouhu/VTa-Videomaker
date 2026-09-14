/** Timecode and frame helpers. All timeline math is in seconds (float). */

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Rounds a time to the nearest frame boundary for the given fps. */
export function snapToFrame(seconds: number, fps: number): number {
  if (fps <= 0) return seconds;
  return Math.round(seconds * fps) / fps;
}

export function secondsToFrames(seconds: number, fps: number): number {
  return Math.round(seconds * fps);
}

export function framesToSeconds(frames: number, fps: number): number {
  return fps > 0 ? frames / fps : 0;
}

/** HH:MM:SS:FF (design doc section 10). */
export function formatTimecode(seconds: number, fps: number): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const totalFrames = Math.round(safe * fps);
  const frames = totalFrames % Math.max(1, Math.round(fps));
  const totalSeconds = Math.floor(totalFrames / Math.max(1, Math.round(fps)));
  const s = totalSeconds % 60;
  const m = Math.floor(totalSeconds / 60) % 60;
  const h = Math.floor(totalSeconds / 3600);
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}:${pad(frames)}`;
}

/** MM:SS, used on media thumbnails. */
export function formatDuration(seconds: number): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const total = Math.round(safe);
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** Floating point tolerance for timeline comparisons (~1/4 frame at 60fps). */
export const TIME_EPSILON = 1e-4;

export function timeEquals(a: number, b: number, epsilon = TIME_EPSILON): boolean {
  return Math.abs(a - b) < epsilon;
}
