/** Mask motion tracking in the browser.
 *
 * The same normalised cross-correlation the desktop core uses, run on frames
 * drawn to a canvas instead of decoded by FFmpeg. NCC is invariant to
 * brightness changes, which is what breaks simpler difference-based tracking.
 */

import type { TrackSample } from "@/types/effects";
import { grayscaleFrame, loadVideo } from "./frames";

/** Frames sampled per second while tracking. */
export const TRACK_FPS = 10;
/** Width frames are scaled to; tracking does not need full resolution. */
export const TRACK_WIDTH = 320;
/** How far, in pixels, the target may move between sampled frames. */
export const SEARCH_RADIUS = 24;
/** Below this correlation the match is treated as unreliable. */
export const MIN_CONFIDENCE = 0.5;

interface Frame {
  width: number;
  height: number;
  pixels: Uint8Array;
}

/** Copies a rectangular patch out of a frame. */
export function crop(
  frame: Frame,
  x: number,
  y: number,
  width: number,
  height: number,
): Frame {
  const w = Math.max(1, Math.min(width, frame.width - x));
  const h = Math.max(1, Math.min(height, frame.height - y));
  const pixels = new Uint8Array(w * h);

  for (let row = 0; row < h; row += 1) {
    const start = (y + row) * frame.width + x;
    pixels.set(frame.pixels.subarray(start, start + w), row * w);
  }
  return { width: w, height: h, pixels };
}

/**
 * Normalised cross-correlation of a template against a frame region.
 * Returns -1..1; a flat region returns 0 because correlation is undefined.
 */
export function correlation(
  frame: Frame,
  template: Frame,
  originX: number,
  originY: number,
): number {
  if (
    originX < 0 ||
    originY < 0 ||
    originX + template.width > frame.width ||
    originY + template.height > frame.height
  ) {
    return -1;
  }

  const count = template.width * template.height;
  let frameSum = 0;
  let templateSum = 0;

  for (let y = 0; y < template.height; y += 1) {
    for (let x = 0; x < template.width; x += 1) {
      frameSum += frame.pixels[(originY + y) * frame.width + originX + x] ?? 0;
      templateSum += template.pixels[y * template.width + x] ?? 0;
    }
  }

  const frameMean = frameSum / count;
  const templateMean = templateSum / count;

  let numerator = 0;
  let frameVariance = 0;
  let templateVariance = 0;

  for (let y = 0; y < template.height; y += 1) {
    for (let x = 0; x < template.width; x += 1) {
      const f = (frame.pixels[(originY + y) * frame.width + originX + x] ?? 0) - frameMean;
      const t = (template.pixels[y * template.width + x] ?? 0) - templateMean;
      numerator += f * t;
      frameVariance += f * f;
      templateVariance += t * t;
    }
  }

  const denominator = Math.sqrt(frameVariance * templateVariance);
  return denominator <= Number.EPSILON ? 0 : numerator / denominator;
}

/** Finds the best match for `template` near (fromX, fromY). */
export function findBestMatch(
  frame: Frame,
  template: Frame,
  fromX: number,
  fromY: number,
  radius = SEARCH_RADIUS,
): { x: number; y: number; score: number } {
  let best = { x: fromX, y: fromY, score: -1 };

  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const score = correlation(frame, template, fromX + dx, fromY + dy);
      if (score > best.score) best = { x: fromX + dx, y: fromY + dy, score };
    }
  }
  return best;
}

/**
 * Tracks a normalised region through a clip.
 *
 * The template is refreshed on a strong match so gradual changes in appearance
 * are followed; a weak match holds the last position rather than locking onto
 * the background.
 */
export async function trackRegion(
  url: string,
  startSeconds: number,
  durationSeconds: number,
  region: [number, number, number, number],
): Promise<TrackSample[]> {
  const video = await loadVideo(url);
  const canvas = document.createElement("canvas");

  try {
    const sampleCount = Math.max(1, Math.ceil(durationSeconds * TRACK_FPS));
    const first = await grayscaleFrame(video, startSeconds, TRACK_WIDTH, canvas);

    const [rx, ry, rw, rh] = region;
    const startX = Math.max(0, Math.round(rx * first.width));
    const startY = Math.max(0, Math.round(ry * first.height));
    const width = clamp(Math.round(rw * first.width), 4, first.width);
    const height = clamp(Math.round(rh * first.height), 4, first.height);

    let template = crop(first, startX, startY, width, height);
    let position = { x: startX, y: startY };

    const samples: TrackSample[] = [
      { time: 0, offsetX: 0, offsetY: 0, scale: 1, confidence: 1 },
    ];

    for (let index = 1; index < sampleCount; index += 1) {
      const time = startSeconds + index / TRACK_FPS;
      const frame = await grayscaleFrame(video, time, TRACK_WIDTH, canvas);
      const match = findBestMatch(frame, template, position.x, position.y);

      if (match.score >= MIN_CONFIDENCE) {
        position = { x: match.x, y: match.y };
        template = crop(frame, Math.max(0, match.x), Math.max(0, match.y), width, height);
      }

      samples.push({
        time: index / TRACK_FPS,
        offsetX: (position.x - startX) / first.width,
        offsetY: (position.y - startY) / first.height,
        // Scale estimation needs a multi-scale search; the shape keeps its size.
        scale: 1,
        confidence: Math.max(0, match.score),
      });
    }
    return samples;
  } finally {
    video.src = "";
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
