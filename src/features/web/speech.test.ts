import { describe, expect, it } from "vitest";
import { DEFAULT_SPEECH_MODEL, SPEECH_MODELS, toSegments } from "./speech";

describe("Whisper chunk mapping", () => {
  it("maps chunks with both timestamps", () => {
    const segments = toSegments(
      [
        { timestamp: [0, 2.5], text: " 今日はAIについて説明します " },
        { timestamp: [2.5, 5], text: "まず全体像から" },
      ],
      5,
    );
    expect(segments).toEqual([
      { start: 0, end: 2.5, text: "今日はAIについて説明します" },
      { start: 2.5, end: 5, text: "まず全体像から" },
    ]);
  });

  it("closes an open-ended chunk at the next chunk's start", () => {
    // Whisper leaves the end null mid-stream; dropping those loses speech.
    const segments = toSegments(
      [
        { timestamp: [0, null], text: "ひとつめ" },
        { timestamp: [3, 5], text: "ふたつめ" },
      ],
      5,
    );
    expect(segments[0]).toMatchObject({ start: 0, end: 3 });
  });

  it("closes a trailing open-ended chunk at the clip duration", () => {
    const segments = toSegments([{ timestamp: [8, null], text: "最後" }], 12);
    expect(segments[0]).toMatchObject({ start: 8, end: 12 });
  });

  it("still produces a usable range when the duration is shorter than the start", () => {
    const segments = toSegments([{ timestamp: [30, null], text: "末尾" }], 10);
    expect(segments[0]!.end).toBeGreaterThan(segments[0]!.start);
  });

  it("drops empty chunks", () => {
    expect(toSegments([{ timestamp: [0, 1], text: "   " }], 1)).toHaveLength(0);
  });

  it("drops a chunk that ends before it starts", () => {
    expect(toSegments([{ timestamp: [5, 2], text: "逆転" }], 10)).toHaveLength(0);
  });

  it("drops a chunk with a non-finite timestamp", () => {
    expect(
      toSegments([{ timestamp: [Number.NaN, 2], text: "壊れている" }], 10),
    ).toHaveLength(0);
  });

  it("returns nothing for no chunks", () => {
    expect(toSegments([], 10)).toHaveLength(0);
  });
});

describe("model catalogue", () => {
  it("defaults to a model in the list", () => {
    expect(SPEECH_MODELS.some((model) => model.id === DEFAULT_SPEECH_MODEL)).toBe(true);
  });

  it("offers models with timestamp support", () => {
    // Timestamps are what the cut planners need; a model without them is
    // useless here however good its text is.
    expect(SPEECH_MODELS.every((model) => model.id.includes("timestamped"))).toBe(true);
  });
});
