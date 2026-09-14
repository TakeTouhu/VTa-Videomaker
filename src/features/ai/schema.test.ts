import { describe, expect, it } from "vitest";
import { MAX_ACTIONS_PER_PLAN, parseEditPlan } from "./schema";

function plan(actions: unknown[]) {
  return {
    id: "plan_1",
    prompt: "無音を削除",
    summary: "3箇所の無音を削除します",
    actions,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("edit plan schema validation", () => {
  it("accepts a well formed plan", () => {
    const result = parseEditPlan(
      plan([{ type: "delete", clipId: "c1", start: 1, end: 2, ripple: true }]),
    );
    expect(result.ok).toBe(true);
  });

  it("accepts the plan as a JSON string", () => {
    const result = parseEditPlan(
      JSON.stringify(plan([{ type: "cut", clipId: "c1", at: 3 }])),
    );
    expect(result.ok).toBe(true);
  });

  it("rejects output that is not JSON at all", () => {
    const result = parseEditPlan("I have cut the silences for you!");
    expect(result.ok).toBe(false);
  });

  it("rejects an unknown action type", () => {
    const result = parseEditPlan(plan([{ type: "render", clipId: "c1" }]));
    expect(result.ok).toBe(false);
  });

  it("rejects an action that is missing its clip id", () => {
    const result = parseEditPlan(plan([{ type: "cut", at: 3 }]));
    expect(result.ok).toBe(false);
  });

  it("rejects negative and non-finite times", () => {
    expect(parseEditPlan(plan([{ type: "cut", clipId: "c1", at: -5 }])).ok).toBe(false);
    expect(
      parseEditPlan(plan([{ type: "cut", clipId: "c1", at: Number.POSITIVE_INFINITY }])).ok,
    ).toBe(false);
  });

  it("rejects colour values outside the UI range", () => {
    const result = parseEditPlan(
      plan([{ type: "color", clipId: "c1", color: { saturation: 5000 } }]),
    );
    expect(result.ok).toBe(false);
  });

  it("rejects a colour action that changes nothing", () => {
    const result = parseEditPlan(plan([{ type: "color", clipId: "c1", color: {} }]));
    expect(result.ok).toBe(false);
  });

  it("rejects an absurd speed", () => {
    expect(parseEditPlan(plan([{ type: "speed", clipId: "c1", speed: 0 }])).ok).toBe(false);
    expect(parseEditPlan(plan([{ type: "speed", clipId: "c1", speed: 1000 }])).ok).toBe(false);
  });

  it("rejects an empty plan", () => {
    expect(parseEditPlan(plan([])).ok).toBe(false);
  });

  it("caps the number of actions in one plan", () => {
    const actions = Array.from({ length: MAX_ACTIONS_PER_PLAN + 1 }, () => ({
      type: "cut",
      clipId: "c1",
      at: 1,
    }));
    expect(parseEditPlan(plan(actions)).ok).toBe(false);
  });

  it("defaults ripple to true when the model omits it", () => {
    const result = parseEditPlan(plan([{ type: "delete", clipId: "c1", start: 1, end: 2 }]));
    expect(result.ok && result.plan.actions[0]).toMatchObject({ ripple: true });
  });

  it("reports the failing field so the failure can be logged", () => {
    const result = parseEditPlan(plan([{ type: "cut", clipId: "c1", at: "soon" }]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.join()).toContain("actions.0.at");
  });
});
