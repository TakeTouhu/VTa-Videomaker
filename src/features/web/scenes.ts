/** Scene boundary detection in the browser.
 *
 * Samples frames and compares their luma histograms: a large change means a
 * cut. This is the same idea as FFmpeg's scene score, done on canvas pixels.
 */

import { drawFrame, loadVideo, seekTo } from "./frames";

/** Frames sampled per second. Fast cuts below this are missed, which is fine
 *  for placing edits - it is not a frame-accurate shot detector. */
export const SAMPLE_FPS = 4;
/** Histogram difference above which a cut is reported, 0..1. */
export const DEFAULT_THRESHOLD = 0.35;
const BINS = 32;

/** Normalised luma histogram of the current frame. */
function histogram(context: CanvasRenderingContext2D, width: number, height: number): number[] {
  const image = context.getImageData(0, 0, width, height);
  const bins = new Array<number>(BINS).fill(0);

  for (let offset = 0; offset < image.data.length; offset += 4) {
    const luma =
      0.299 * (image.data[offset] ?? 0) +
      0.587 * (image.data[offset + 1] ?? 0) +
      0.114 * (image.data[offset + 2] ?? 0);
    const bin = Math.min(BINS - 1, Math.floor((luma / 256) * BINS));
    bins[bin] = (bins[bin] ?? 0) + 1;
  }

  const total = image.data.length / 4;
  return bins.map((count) => count / total);
}

/** Total variation distance between two histograms, 0..1. */
export function histogramDistance(a: number[], b: number[]): number {
  let sum = 0;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    sum += Math.abs((a[index] ?? 0) - (b[index] ?? 0));
  }
  return sum / 2;
}

export async function detectScenes(
  url: string,
  threshold = DEFAULT_THRESHOLD,
): Promise<number[]> {
  const video = await loadVideo(url);
  const canvas = document.createElement("canvas");
  const scenes: number[] = [];

  try {
    const duration = video.duration;
    if (!Number.isFinite(duration) || duration <= 0) return [];

    const step = 1 / SAMPLE_FPS;
    let previous: number[] | null = null;

    for (let time = 0; time < duration; time += step) {
      await seekTo(video, time);
      drawFrame(video, 160, canvas);

      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) break;

      const current = histogram(context, canvas.width, canvas.height);
      if (previous && histogramDistance(previous, current) >= threshold && time > 0) {
        scenes.push(Number(time.toFixed(3)));
      }
      previous = current;
    }
    return scenes;
  } finally {
    video.src = "";
  }
}

/** Turns boundaries into [start, end) shot ranges covering the whole file. */
export function shots(scenes: number[], duration: number): [number, number][] {
  const bounds = [0, ...scenes.filter((t) => t > 0 && t < duration), duration];
  const ranges: [number, number][] = [];

  for (let index = 1; index < bounds.length; index += 1) {
    const start = bounds[index - 1]!;
    const end = bounds[index]!;
    if (end > start) ranges.push([start, end]);
  }
  return ranges;
}
