import { describe, expect, it } from "vitest";
import {
  buildCondensePlan,
  buildFillerCutPlan,
  normaliseForComparison,
  segmentImportance,
  segmentsOnTimeline,
  similarity,
} from "./transcriptPlans";
import type { MediaAnalysis, TranscriptSegment } from "@/types/ai";
import { makeClip, makeSequence } from "@/features/timeline/__tests__/fixtures";

function analysis(transcript: TranscriptSegment[]): MediaAnalysis {
  return {
    mediaId: "m1",
    transcript,
    silences: [],
    scenes: [],
    analyzedAt: "2026-01-01T00:00:00.000Z",
  };
}

const sequence = makeSequence([
  makeClip({ id: "c1", mediaId: "m1", startTime: 0, sourceIn: 0, sourceOut: 60 }),
]);

describe("segmentsOnTimeline", () => {
  it("maps source times onto the timeline", () => {
    const trimmed = makeSequence([
      makeClip({ id: "c1", mediaId: "m1", startTime: 10, sourceIn: 5, sourceOut: 20 }),
    ]);
    const segments = segmentsOnTimeline(trimmed, [
      analysis([{ start: 7, end: 9, text: "hello" }]),
    ]);
    expect(segments[0]).toMatchObject({ clipId: "c1", start: 12, end: 14 });
  });

  it("accounts for speed", () => {
    const fast = makeSequence([
      makeClip({ id: "c1", mediaId: "m1", startTime: 0, sourceIn: 0, sourceOut: 20, speed: 2 }),
    ]);
    const segments = segmentsOnTimeline(fast, [
      analysis([{ start: 8, end: 12, text: "hello" }]),
    ]);
    expect(segments[0]!.start).toBeCloseTo(4);
    expect(segments[0]!.end).toBeCloseTo(6);
  });

  it("drops segments outside the clip's source range", () => {
    const segments = segmentsOnTimeline(sequence, [
      analysis([{ start: 100, end: 105, text: "later" }]),
    ]);
    expect(segments).toHaveLength(0);
  });

  it("returns segments in timeline order", () => {
    const segments = segmentsOnTimeline(sequence, [
      analysis([
        { start: 20, end: 22, text: "second" },
        { start: 5, end: 7, text: "first" },
      ]),
    ]);
    expect(segments.map((segment) => segment.text)).toEqual(["first", "second"]);
  });
});

describe("similarity", () => {
  it("is 1 for identical text", () => {
    expect(similarity("こんにちは", "こんにちは")).toBe(1);
  });

  it("ignores punctuation and case", () => {
    expect(similarity("Hello, world.", "hello world")).toBe(1);
  });

  it("is high for a restated line", () => {
    expect(similarity("今日はAIについて説明し", "今日はAIについて説明します")).toBeGreaterThan(
      0.8,
    );
  });

  it("is low for unrelated lines", () => {
    expect(similarity("今日は天気がいいですね", "来週の予算を確認します")).toBeLessThan(0.5);
  });

  it("is 0 when either side is empty", () => {
    expect(similarity("", "something")).toBe(0);
  });

  it("normalises away spacing and punctuation", () => {
    expect(normaliseForComparison("あ、い。う ")).toBe("あいう");
  });
});

describe("buildFillerCutPlan", () => {
  it("removes filler words", () => {
    const plan = buildFillerCutPlan(sequence, [
      analysis([
        { start: 1, end: 1.4, text: "えー" },
        { start: 2, end: 4, text: "今日はAIについて説明します" },
      ]),
    ]);
    expect(plan.actions).toHaveLength(1);
    expect(plan.actions[0]).toMatchObject({ type: "delete", reason: "フィラー" });
  });

  it("removes a false start and keeps the retake", () => {
    const plan = buildFillerCutPlan(sequence, [
      analysis([
        { start: 1, end: 3, text: "今日はAIについて説明し" },
        { start: 3.5, end: 6, text: "今日はAIについて説明します" },
      ]),
    ]);
    expect(plan.actions).toHaveLength(1);
    const action = plan.actions[0]!;
    if (action.type !== "delete") throw new Error("expected a delete");
    // The earlier attempt goes, not the later one.
    expect(action.start).toBe(1);
    expect(action.reason).toBe("言い直し");
  });

  it("keeps distinct consecutive lines", () => {
    const plan = buildFillerCutPlan(sequence, [
      analysis([
        { start: 1, end: 3, text: "まず全体像を説明します" },
        { start: 3, end: 6, text: "次に具体例を見ていきます" },
      ]),
    ]);
    expect(plan.actions).toHaveLength(0);
  });

  it("says so when there is nothing to remove", () => {
    const plan = buildFillerCutPlan(sequence, [analysis([])]);
    expect(plan.summary).toContain("見つかりませんでした");
  });

  it("does not treat lines on different clips as retakes", () => {
    const two = makeSequence([
      makeClip({ id: "c1", mediaId: "m1", startTime: 0, sourceIn: 0, sourceOut: 5 }),
      makeClip({ id: "c2", mediaId: "m1", startTime: 5, sourceIn: 5, sourceOut: 10 }),
    ]);
    const plan = buildFillerCutPlan(two, [
      analysis([
        { start: 1, end: 3, text: "同じことを言います" },
        { start: 6, end: 8, text: "同じことを言います" },
      ]),
    ]);
    expect(plan.actions).toHaveLength(0);
  });
});

describe("buildCondensePlan", () => {
  const speech = analysis([
    { start: 0, end: 5, text: "重要な結論から述べます" },
    { start: 20, end: 25, text: "細かい補足の話をします" },
    { start: 50, end: 60, text: "最後にまとめます" },
  ]);

  it("does nothing when the sequence already fits", () => {
    const plan = buildCondensePlan(sequence, [speech], 600);
    expect(plan.actions).toHaveLength(0);
    expect(plan.summary).toContain("目標を下回っています");
  });

  it("removes gaps before dropping speech", () => {
    const plan = buildCondensePlan(sequence, [speech], 50);
    expect(plan.actions.length).toBeGreaterThan(0);
    expect(plan.actions.every((action) => action.reason === "間")).toBe(true);
  });

  it("drops the least important speech when gaps are not enough", () => {
    const plan = buildCondensePlan(sequence, [speech], 10);
    const reasons = new Set(plan.actions.map((action) => action.reason));
    expect(reasons.has("重要度が低い")).toBe(true);
  });

  it("reports when it cannot reach the target", () => {
    const plan = buildCondensePlan(sequence, [speech], 1);
    expect(plan.summary).toContain("目標に届きません");
  });

  it("refuses to guess without a transcript", () => {
    const plan = buildCondensePlan(sequence, [analysis([])], 10);
    expect(plan.actions).toHaveLength(0);
    expect(plan.summary).toContain("文字起こしがない");
  });

  it("ranks a dense, emphasised line as more important", () => {
    const important = segmentImportance({
      clipId: "c1",
      start: 0,
      end: 2,
      text: "つまり結論はこうです",
    });
    const filler = segmentImportance({
      clipId: "c1",
      start: 0,
      end: 10,
      text: "えっと",
    });
    expect(important).toBeGreaterThan(filler);
  });
});

describe("condense safety floor", () => {
  const speech = {
    mediaId: "m1",
    transcript: [
      { start: 0, end: 5, text: "重要な結論から述べます" },
      { start: 20, end: 25, text: "細かい補足の話をします" },
      { start: 50, end: 60, text: "最後にまとめます" },
    ],
    silences: [],
    scenes: [],
    analyzedAt: "2026-01-01T00:00:00.000Z",
  };

  it("never proposes removing every spoken line", () => {
    const plan = buildCondensePlan(sequence, [speech], 1);
    const droppedSpeech = plan.actions.filter(
      (action) => action.reason === "重要度が低い",
    );
    expect(droppedSpeech.length).toBeLessThan(speech.transcript.length);
  });

  it("keeps the most important line", () => {
    const plan = buildCondensePlan(sequence, [speech], 1);
    const removedStarts = plan.actions
      .filter((action) => action.reason === "重要度が低い")
      .map((action) => (action.type === "delete" ? action.start : -1));
    // The dense opening line is the highest scoring one and must survive.
    expect(removedStarts).not.toContain(0);
  });
});
