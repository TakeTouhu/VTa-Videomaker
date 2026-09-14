import { describe, expect, it } from "vitest";
import {
  DEFAULT_CAPTION_OPTIONS,
  buildCaptions,
  captionsToSrt,
  splitForCaption,
  srtTimestamp,
} from "./captions";
import type { MediaAnalysis } from "@/types/ai";
import { makeClip, makeSequence } from "@/features/timeline/__tests__/fixtures";

const sequence = makeSequence([
  makeClip({ id: "c1", mediaId: "m1", startTime: 0, sourceIn: 0, sourceOut: 60 }),
]);

function analysis(transcript: MediaAnalysis["transcript"]): MediaAnalysis {
  return {
    mediaId: "m1",
    transcript,
    silences: [],
    scenes: [],
    analyzedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("caption generation", () => {
  it("creates one cue per short line", () => {
    const cues = buildCaptions(sequence, [
      analysis([{ start: 1, end: 3, text: "こんにちは" }]),
    ]);
    expect(cues).toHaveLength(1);
    expect(cues[0]).toMatchObject({ start: 1, text: "こんにちは" });
  });

  it("splits a long line into several cues", () => {
    const long = "これは非常に長い文章であり、字幕として一度に表示するには明らかに長すぎるため分割されるべきです。さらに続きます。";
    const cues = buildCaptions(sequence, [analysis([{ start: 0, end: 10, text: long }])]);
    expect(cues.length).toBeGreaterThan(1);
  });

  it("divides the time evenly between split cues", () => {
    const long = "あいうえお、かきくけこ、さしすせそ、たちつてと、なにぬねの、はひふへほ。";
    const cues = buildCaptions(sequence, [analysis([{ start: 0, end: 12, text: long }])]);
    const spans = cues.map((cue) => cue.end - cue.start);
    expect(Math.max(...spans) - Math.min(...spans)).toBeLessThan(1e-6);
  });

  it("gives a very short line a readable minimum duration", () => {
    const cues = buildCaptions(sequence, [analysis([{ start: 0, end: 0.2, text: "はい" }])]);
    expect(cues[0]!.end - cues[0]!.start).toBeGreaterThanOrEqual(
      DEFAULT_CAPTION_OPTIONS.minDurationSeconds,
    );
  });

  it("ignores empty transcript lines", () => {
    expect(buildCaptions(sequence, [analysis([{ start: 0, end: 2, text: "   " }])])).toHaveLength(
      0,
    );
  });

  it("wraps at punctuation rather than mid-sentence", () => {
    const chunks = splitForCaption("これは一つ目です。これは二つ目です。", {
      maxCharsPerLine: 12,
      maxLines: 1,
      minDurationSeconds: 1,
    });
    expect(chunks[0]).toContain("。");
  });
});

describe("SRT export", () => {
  it("formats timestamps", () => {
    expect(srtTimestamp(3661.5)).toBe("01:01:01,500");
    expect(srtTimestamp(-5)).toBe("00:00:00,000");
  });

  it("numbers cues from one", () => {
    const srt = captionsToSrt([
      { id: "a", start: 0, end: 1, text: "one" },
      { id: "b", start: 1, end: 2, text: "two" },
    ]);
    expect(srt.startsWith("1\n")).toBe(true);
    expect(srt).toContain("2\n00:00:01,000 --> 00:00:02,000\ntwo");
  });

  it("produces an empty string for no cues", () => {
    expect(captionsToSrt([])).toBe("");
  });
});
