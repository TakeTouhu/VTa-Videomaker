import { describe, expect, it } from "vitest";
import { mergeDeleteRanges, validatePlan } from "./validation";
import type { AIEditAction, EditPlan } from "@/types/ai";
import { V1, V2, makeClip, makeSequence } from "@/features/timeline/__tests__/fixtures";

function planWith(actions: AIEditAction[]): EditPlan {
  return {
    id: "plan_1",
    prompt: "test",
    summary: "test",
    actions,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

const sequence = makeSequence([makeClip({ id: "c1", startTime: 0, sourceOut: 10 })]);

describe("business rule validation", () => {
  it("accepts an action inside an existing clip", () => {
    const result = validatePlan(planWith([{ type: "cut", clipId: "c1", at: 5 }]), sequence);
    expect(result.accepted).toHaveLength(1);
    expect(result.rejected).toHaveLength(0);
  });

  it("rejects an action referring to a clip that does not exist", () => {
    const result = validatePlan(planWith([{ type: "cut", clipId: "ghost", at: 5 }]), sequence);
    expect(result.accepted).toHaveLength(0);
    expect(result.rejected[0]!.code).toBe("unknown_clip");
  });

  it("rejects an edit on a locked track", () => {
    const locked = makeSequence([makeClip({ id: "c1", sourceOut: 10 })], [V1]);
    const result = validatePlan(planWith([{ type: "cut", clipId: "c1", at: 5 }]), locked);
    expect(result.rejected[0]!.code).toBe("locked_track");
  });

  it("rejects a split outside the clip", () => {
    const result = validatePlan(planWith([{ type: "cut", clipId: "c1", at: 99 }]), sequence);
    expect(result.rejected[0]!.code).toBe("time_outside_clip");
  });

  it("rejects a delete range that does not overlap the clip", () => {
    const result = validatePlan(
      planWith([{ type: "delete", clipId: "c1", start: 20, end: 25, ripple: true }]),
      sequence,
    );
    expect(result.rejected[0]!.code).toBe("time_outside_clip");
  });

  it("rejects an empty delete range", () => {
    const result = validatePlan(
      planWith([{ type: "delete", clipId: "c1", start: 4, end: 4, ripple: true }]),
      sequence,
    );
    expect(result.rejected[0]!.code).toBe("invalid_range");
  });

  it("rejects a move to a track that does not exist", () => {
    const result = validatePlan(
      planWith([{ type: "move", clipId: "c1", startTime: 5, trackId: "ghost" }]),
      sequence,
    );
    expect(result.rejected[0]!.code).toBe("unknown_track");
  });

  it("accepts a move to a real track", () => {
    const result = validatePlan(
      planWith([{ type: "move", clipId: "c1", startTime: 5, trackId: V2 }]),
      sequence,
    );
    expect(result.accepted).toHaveLength(1);
  });

  it("rejects a move that changes nothing", () => {
    const result = validatePlan(
      planWith([{ type: "move", clipId: "c1", startTime: 0 }]),
      sequence,
    );
    expect(result.rejected[0]!.code).toBe("no_effect");
  });

  it("keeps the valid actions when only some fail", () => {
    const result = validatePlan(
      planWith([
        { type: "cut", clipId: "c1", at: 5 },
        { type: "cut", clipId: "ghost", at: 5 },
        { type: "volume", clipId: "c1", volume: -6 },
      ]),
      sequence,
    );
    expect(result.accepted).toHaveLength(2);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]!.actionIndex).toBe(1);
  });
});

describe("mergeDeleteRanges", () => {
  it("merges overlapping ranges on the same clip", () => {
    const merged = mergeDeleteRanges([
      { type: "delete", clipId: "c1", start: 1, end: 3, ripple: true },
      { type: "delete", clipId: "c1", start: 2, end: 5, ripple: true },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ start: 1, end: 5 });
  });

  it("keeps ranges that do not touch", () => {
    const merged = mergeDeleteRanges([
      { type: "delete", clipId: "c1", start: 1, end: 2, ripple: true },
      { type: "delete", clipId: "c1", start: 5, end: 6, ripple: true },
    ]);
    expect(merged).toHaveLength(2);
  });

  it("does not merge across different clips", () => {
    const merged = mergeDeleteRanges([
      { type: "delete", clipId: "c1", start: 1, end: 3, ripple: true },
      { type: "delete", clipId: "c2", start: 2, end: 4, ripple: true },
    ]);
    expect(merged).toHaveLength(2);
  });

  it("leaves other action types untouched", () => {
    const merged = mergeDeleteRanges([
      { type: "cut", clipId: "c1", at: 2 },
      { type: "delete", clipId: "c1", start: 1, end: 3, ripple: true },
      { type: "delete", clipId: "c1", start: 2, end: 5, ripple: true },
    ]);
    expect(merged.filter((action) => action.type === "cut")).toHaveLength(1);
  });
});
