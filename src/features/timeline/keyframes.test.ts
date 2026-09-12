import { describe, expect, it } from "vitest";
import {
  evaluateTrack,
  isAnimated,
  removeKeyframe,
  resolveClipAt,
  setKeyframe,
  sortKeyframes,
  staticValue,
} from "./keyframes";
import type { KeyframeTrack } from "@/types/effects";
import { makeClip } from "./__tests__/fixtures";

const track: KeyframeTrack = {
  property: "transform.opacity",
  keyframes: [
    { time: 0, value: 0, interpolation: "linear" },
    { time: 2, value: 100, interpolation: "linear" },
  ],
};

describe("keyframe evaluation", () => {
  it("interpolates linearly between keyframes", () => {
    expect(evaluateTrack(track, 1)).toBeCloseTo(50);
  });

  it("holds the value before the first and after the last keyframe", () => {
    expect(evaluateTrack(track, -5)).toBe(0);
    expect(evaluateTrack(track, 99)).toBe(100);
  });

  it("holds the previous value with hold interpolation", () => {
    const held: KeyframeTrack = {
      property: "transform.opacity",
      keyframes: [
        { time: 0, value: 20, interpolation: "hold" },
        { time: 2, value: 80, interpolation: "linear" },
      ],
    };
    expect(evaluateTrack(held, 1.9)).toBe(20);
    expect(evaluateTrack(held, 2)).toBe(80);
  });

  it("eases symmetrically around the midpoint", () => {
    const eased: KeyframeTrack = {
      property: "transform.opacity",
      keyframes: [
        { time: 0, value: 0, interpolation: "ease" },
        { time: 2, value: 100, interpolation: "linear" },
      ],
    };
    expect(evaluateTrack(eased, 1)).toBeCloseTo(50);
    // Ease starts slower than linear.
    expect(evaluateTrack(eased, 0.4)!).toBeLessThan(20);
  });

  it("returns undefined for an empty track", () => {
    expect(evaluateTrack({ property: "transform.scale", keyframes: [] }, 1)).toBeUndefined();
  });

  it("sorts keyframes supplied out of order", () => {
    const sorted = sortKeyframes([
      { time: 5, value: 1, interpolation: "linear" },
      { time: 1, value: 0, interpolation: "linear" },
    ]);
    expect(sorted[0]!.time).toBe(1);
  });
});

describe("resolveClipAt", () => {
  const animated = makeClip({
    id: "c1",
    startTime: 10,
    sourceIn: 0,
    sourceOut: 10,
    keyframes: [track],
  });

  it("returns the clip unchanged when nothing is animated", () => {
    const plain = makeClip({ id: "c1" });
    expect(resolveClipAt(plain, 5)).toBe(plain);
  });

  it("uses clip-relative time so moving a clip keeps its animation", () => {
    // The clip starts at 10s, so sequence time 11s is 1s into the clip.
    expect(resolveClipAt(animated, 11).transform.opacity).toBeCloseTo(50);
  });

  it("accounts for speed", () => {
    const fast = makeClip({
      id: "c1",
      startTime: 0,
      sourceOut: 10,
      speed: 2,
      keyframes: [track],
    });
    // At 0.5s of sequence time, 1s of source time has elapsed.
    expect(resolveClipAt(fast, 0.5).transform.opacity).toBeCloseTo(50);
  });

  it("animates colour parameters too", () => {
    const graded = makeClip({
      id: "c1",
      startTime: 0,
      keyframes: [
        {
          property: "color.exposure",
          keyframes: [
            { time: 0, value: 0, interpolation: "linear" },
            { time: 2, value: 40, interpolation: "linear" },
          ],
        },
      ],
    });
    expect(resolveClipAt(graded, 1).color.exposure).toBeCloseTo(20);
  });

  it("does not mutate the original clip", () => {
    resolveClipAt(animated, 11);
    expect(animated.transform.opacity).toBe(100);
  });
});

describe("editing keyframes", () => {
  const clip = makeClip({ id: "c1", startTime: 0, sourceOut: 10 });

  it("creates a track on the first keyframe", () => {
    const tracks = setKeyframe(clip, "transform.scale", 1, 150);
    expect(tracks).toHaveLength(1);
    expect(tracks[0]!.keyframes[0]).toMatchObject({ time: 1, value: 150 });
  });

  it("replaces a keyframe at the same time rather than duplicating it", () => {
    const withOne = { ...clip, keyframes: setKeyframe(clip, "transform.scale", 1, 150) };
    const tracks = setKeyframe(withOne, "transform.scale", 1, 200);
    expect(tracks[0]!.keyframes).toHaveLength(1);
    expect(tracks[0]!.keyframes[0]!.value).toBe(200);
  });

  it("keeps keyframes sorted", () => {
    let current = { ...clip, keyframes: setKeyframe(clip, "transform.scale", 5, 10) };
    current = { ...current, keyframes: setKeyframe(current, "transform.scale", 1, 20) };
    expect(current.keyframes![0]!.keyframes.map((k) => k.time)).toEqual([1, 5]);
  });

  it("removes a keyframe and drops an emptied track", () => {
    const withOne = { ...clip, keyframes: setKeyframe(clip, "transform.scale", 1, 150) };
    expect(removeKeyframe(withOne, "transform.scale", 1)).toHaveLength(0);
  });

  it("reports whether a property is animated", () => {
    const withOne = { ...clip, keyframes: setKeyframe(clip, "transform.scale", 1, 150) };
    expect(isAnimated(withOne, "transform.scale")).toBe(true);
    expect(isAnimated(withOne, "transform.opacity")).toBe(false);
  });

  it("reads the static value of a property", () => {
    expect(staticValue(clip, "transform.opacity")).toBe(100);
    expect(staticValue(clip, "color.saturation")).toBe(100);
    expect(staticValue(clip, "audio.volume")).toBe(0);
  });
});
