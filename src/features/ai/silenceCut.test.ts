import { describe, expect, it } from "vitest";
import { DEFAULT_SILENCE_CUT_OPTIONS, buildSilenceCutPlan, isFiller } from "./silenceCut";
import type { MediaAnalysis } from "@/types/ai";
import { makeClip, makeSequence } from "@/features/timeline/__tests__/fixtures";

function analysis(silences: { start: number; end: number }[]): MediaAnalysis {
  return {
    mediaId: "m1",
    transcript: [],
    silences,
    scenes: [],
    analyzedAt: "2026-01-01T00:00:00.000Z",
  };
}

const sequence = makeSequence([
  makeClip({ id: "c1", mediaId: "m1", startTime: 0, sourceIn: 0, sourceOut: 30 }),
]);

describe("AI silence cut", () => {
  it("proposes a delete for each long enough silence", () => {
    const plan = buildSilenceCutPlan(sequence, [
      analysis([
        { start: 2, end: 5 },
        { start: 10, end: 14 },
      ]),
    ]);
    expect(plan.actions).toHaveLength(2);
    expect(plan.actions.every((action) => action.type === "delete")).toBe(true);
  });

  it("keeps padding around each cut so speech is not clipped", () => {
    const plan = buildSilenceCutPlan(sequence, [analysis([{ start: 2, end: 5 }])]);
    const action = plan.actions[0]!;
    if (action.type !== "delete") throw new Error("expected a delete action");
    expect(action.start).toBeCloseTo(2 + DEFAULT_SILENCE_CUT_OPTIONS.paddingSeconds);
    expect(action.end).toBeCloseTo(5 - DEFAULT_SILENCE_CUT_OPTIONS.paddingSeconds);
  });

  it("ignores silences shorter than the minimum", () => {
    const plan = buildSilenceCutPlan(sequence, [analysis([{ start: 2, end: 2.3 }])]);
    expect(plan.actions).toHaveLength(0);
  });

  it("maps source time to sequence time for a trimmed clip", () => {
    const trimmed = makeSequence([
      makeClip({ id: "c1", mediaId: "m1", startTime: 10, sourceIn: 5, sourceOut: 20 }),
    ]);
    const plan = buildSilenceCutPlan(trimmed, [analysis([{ start: 8, end: 11 }])]);
    const action = plan.actions[0]!;
    if (action.type !== "delete") throw new Error("expected a delete action");
    // Source 8s is 3s into the clip, which starts at 10s on the timeline.
    expect(action.start).toBeCloseTo(13 + DEFAULT_SILENCE_CUT_OPTIONS.paddingSeconds);
  });

  it("accounts for clip speed", () => {
    const fast = makeSequence([
      makeClip({ id: "c1", mediaId: "m1", startTime: 0, sourceIn: 0, sourceOut: 20, speed: 2 }),
    ]);
    const plan = buildSilenceCutPlan(fast, [analysis([{ start: 8, end: 12 }])]);
    const action = plan.actions[0]!;
    if (action.type !== "delete") throw new Error("expected a delete action");
    expect(action.start).toBeCloseTo(4 + DEFAULT_SILENCE_CUT_OPTIONS.paddingSeconds);
  });

  it("ignores silence outside the clip's source range", () => {
    const plan = buildSilenceCutPlan(
      makeSequence([
        makeClip({ id: "c1", mediaId: "m1", startTime: 0, sourceIn: 0, sourceOut: 10 }),
      ]),
      [analysis([{ start: 50, end: 55 }])],
    );
    expect(plan.actions).toHaveLength(0);
  });

  it("removes a wholly silent clip instead of leaving unusable slivers", () => {
    const plan = buildSilenceCutPlan(
      makeSequence([
        makeClip({ id: "c1", mediaId: "m1", startTime: 0, sourceIn: 0, sourceOut: 5 }),
      ]),
      [analysis([{ start: 0, end: 5 }])],
    );
    const action = plan.actions[0]!;
    if (action.type !== "delete") throw new Error("expected a delete action");
    // No neighbouring speech to protect, so neither edge is padded.
    expect(action.start).toBeCloseTo(0);
    expect(action.end).toBeCloseTo(5);
  });

  it("pads only the edge that borders speech", () => {
    const plan = buildSilenceCutPlan(
      makeSequence([
        makeClip({ id: "c1", mediaId: "m1", startTime: 0, sourceIn: 0, sourceOut: 10 }),
      ]),
      [analysis([{ start: 0, end: 3 }])],
    );
    const action = plan.actions[0]!;
    if (action.type !== "delete") throw new Error("expected a delete action");
    expect(action.start).toBeCloseTo(0);
    expect(action.end).toBeCloseTo(3 - DEFAULT_SILENCE_CUT_OPTIONS.paddingSeconds);
  });

  it("ignores analysis for media that is not on the timeline", () => {
    const plan = buildSilenceCutPlan(sequence, [
      { ...analysis([{ start: 2, end: 5 }]), mediaId: "other" },
    ]);
    expect(plan.actions).toHaveLength(0);
  });

  it("says so plainly when there is nothing to cut", () => {
    const plan = buildSilenceCutPlan(sequence, [analysis([])]);
    expect(plan.actions).toHaveLength(0);
    expect(plan.summary).toContain("見つかりませんでした");
  });

  it("reports how much time the cuts remove", () => {
    const plan = buildSilenceCutPlan(sequence, [analysis([{ start: 2, end: 5 }])]);
    expect(plan.summary).toMatch(/2\.\d 秒/);
  });
});

describe("filler detection", () => {
  it("matches Japanese fillers", () => {
    expect(isFiller("えー")).toBe(true);
    expect(isFiller("あのー")).toBe(true);
    expect(isFiller("そのー")).toBe(true);
  });

  it("matches English fillers", () => {
    expect(isFiller("um")).toBe(true);
    expect(isFiller("uhh")).toBe(true);
  });

  it("does not match real speech", () => {
    expect(isFiller("今日はAIについて説明します")).toBe(false);
    expect(isFiller("あのプロジェクトについて")).toBe(false);
  });
});
