import { describe, expect, it } from "vitest";
import {
  DEFAULT_COLOR,
  LINEAR_CURVE,
  evaluateCurve,
  hasCurveAdjustment,
  isDefaultColor,
  isLinearCurve,
  normalizeCurve,
} from "./color";

describe("curves", () => {
  it("treats the diagonal as linear", () => {
    expect(isLinearCurve(LINEAR_CURVE)).toBe(true);
    expect(isLinearCurve(undefined)).toBe(true);
    expect(isLinearCurve([{ x: 0, y: 0.5 }])).toBe(false);
  });

  it("evaluates a linear curve as the identity", () => {
    expect(evaluateCurve(LINEAR_CURVE, 0.37)).toBeCloseTo(0.37);
  });

  it("interpolates between control points", () => {
    const curve = [
      { x: 0, y: 0 },
      { x: 0.5, y: 0.8 },
      { x: 1, y: 1 },
    ];
    expect(evaluateCurve(curve, 0.25)).toBeCloseTo(0.4);
    expect(evaluateCurve(curve, 0.5)).toBeCloseTo(0.8);
  });

  it("clamps outside the control point range", () => {
    const curve = [
      { x: 0.2, y: 0.3 },
      { x: 0.8, y: 0.9 },
    ];
    expect(evaluateCurve(curve, 0)).toBeCloseTo(0.3);
    expect(evaluateCurve(curve, 1)).toBeCloseTo(0.9);
  });

  it("sorts and clamps points into the unit square", () => {
    const normalized = normalizeCurve([
      { x: 2, y: -1 },
      { x: 0.5, y: 0.5 },
    ]);
    expect(normalized).toEqual([
      { x: 0.5, y: 0.5 },
      { x: 1, y: 0 },
    ]);
  });

  it("counts a curve as an adjustment only when it bends", () => {
    expect(hasCurveAdjustment({ rgb: LINEAR_CURVE })).toBe(false);
    expect(hasCurveAdjustment({ red: [{ x: 0, y: 0.4 }] })).toBe(true);
  });
});

describe("isDefaultColor", () => {
  it("is true for untouched settings", () => {
    expect(isDefaultColor(DEFAULT_COLOR)).toBe(true);
  });

  it("is false once a basic parameter moves", () => {
    expect(isDefaultColor({ ...DEFAULT_COLOR, exposure: 1 })).toBe(false);
  });

  it("is false once a curve bends, even with default basics", () => {
    expect(
      isDefaultColor({ ...DEFAULT_COLOR, curves: { rgb: [{ x: 0, y: 0.3 }] } }),
    ).toBe(false);
  });

  it("stays true for a linear curve", () => {
    expect(isDefaultColor({ ...DEFAULT_COLOR, curves: { rgb: LINEAR_CURVE } })).toBe(true);
  });
});
