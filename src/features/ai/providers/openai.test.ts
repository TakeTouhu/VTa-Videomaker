import { describe, expect, it } from "vitest";
import { normaliseWhisperSegments } from "./openai";

describe("Whisper response mapping", () => {
  it("maps segments with timings", () => {
    const segments = normaliseWhisperSegments({
      segments: [
        { start: 0, end: 2.5, text: " 今日はAIについて説明します " },
        { start: 2.5, end: 5, text: "まず全体像から" },
      ],
    });
    expect(segments).toEqual([
      { start: 0, end: 2.5, text: "今日はAIについて説明します" },
      { start: 2.5, end: 5, text: "まず全体像から" },
    ]);
  });

  it("drops empty segments", () => {
    const segments = normaliseWhisperSegments({
      segments: [{ start: 0, end: 1, text: "   " }],
    });
    expect(segments).toHaveLength(0);
  });

  it("drops segments that end before they start", () => {
    const segments = normaliseWhisperSegments({
      segments: [{ start: 5, end: 4, text: "backwards" }],
    });
    expect(segments).toHaveLength(0);
  });

  it("returns nothing usable when the response has no timings", () => {
    // Text without timings cannot drive a cut, so it is not passed on as if
    // it were one long segment.
    expect(normaliseWhisperSegments({ text: "全文だけ返ってきた" })).toHaveLength(0);
  });
});
