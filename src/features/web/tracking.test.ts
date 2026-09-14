import { describe, expect, it } from "vitest";
import { MIN_CONFIDENCE, correlation, crop, findBestMatch } from "./tracking";

/** A frame with a bright square at (x, y) on a dark background. */
function frameWithSquare(size: number, x: number, y: number, square: number) {
  const pixels = new Uint8Array(size * size).fill(40);
  for (let row = y; row < Math.min(y + square, size); row += 1) {
    for (let column = x; column < Math.min(x + square, size); column += 1) {
      pixels[row * size + column] = 220;
    }
  }
  return { width: size, height: size, pixels };
}

describe("correlation", () => {
  // Templates must contain structure: a uniform patch has zero variance and
  // no correlation is defined for it. Cropping around the square includes its
  // edges, which is what a real mask region looks like.
  it("is one for an exact match", () => {
    const frame = frameWithSquare(64, 10, 10, 8);
    const template = crop(frame, 8, 8, 12, 12);
    expect(correlation(frame, template, 8, 8)).toBeCloseTo(1, 9);
  });

  it("is low at the wrong position", () => {
    const frame = frameWithSquare(64, 10, 10, 8);
    const template = crop(frame, 8, 8, 12, 12);
    expect(correlation(frame, template, 40, 40)).toBeLessThan(0.5);
  });

  it("rejects an out of bounds origin", () => {
    const frame = frameWithSquare(32, 4, 4, 4);
    const template = crop(frame, 2, 2, 8, 8);
    expect(correlation(frame, template, -5, 0)).toBe(-1);
    expect(correlation(frame, template, 30, 30)).toBe(-1);
  });

  it("is zero on a flat region", () => {
    const flat = { width: 16, height: 16, pixels: new Uint8Array(256).fill(100) };
    expect(correlation(flat, crop(flat, 0, 0, 4, 4), 4, 4)).toBe(0);
  });
});

describe("findBestMatch", () => {
  it("finds a target that moved", () => {
    const first = frameWithSquare(64, 10, 10, 8);
    const second = frameWithSquare(64, 18, 14, 8);
    const template = crop(first, 8, 8, 12, 12);

    const match = findBestMatch(second, template, 8, 8);
    // The square moved by (8, 4), so the template origin moves with it.
    expect([match.x, match.y]).toEqual([16, 12]);
    expect(match.score).toBeGreaterThan(0.9);
  });

  it("reports a weak score when the target disappears", () => {
    const first = frameWithSquare(64, 10, 10, 8);
    const flat = { width: 64, height: 64, pixels: new Uint8Array(64 * 64).fill(40) };
    const match = findBestMatch(flat, crop(first, 8, 8, 12, 12), 8, 8);
    expect(match.score).toBeLessThan(MIN_CONFIDENCE);
  });
});

describe("crop", () => {
  it("copies the requested patch", () => {
    const frame = frameWithSquare(16, 4, 4, 4);
    const patch = crop(frame, 4, 4, 4, 4);
    expect(patch.width).toBe(4);
    expect(patch.pixels.every((value) => value === 220)).toBe(true);
  });

  it("clamps a patch that runs past the edge", () => {
    const frame = frameWithSquare(16, 0, 0, 4);
    const patch = crop(frame, 14, 14, 8, 8);
    expect(patch.width).toBe(2);
    expect(patch.height).toBe(2);
  });
});
