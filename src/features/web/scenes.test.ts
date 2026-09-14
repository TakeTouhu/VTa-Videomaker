import { describe, expect, it } from "vitest";
import { histogramDistance, shots } from "./scenes";

describe("histogramDistance", () => {
  it("is zero for identical histograms", () => {
    const histogram = [0.5, 0.3, 0.2];
    expect(histogramDistance(histogram, histogram)).toBe(0);
  });

  it("is one for histograms with no overlap", () => {
    expect(histogramDistance([1, 0], [0, 1])).toBeCloseTo(1);
  });

  it("grows with the difference", () => {
    const near = histogramDistance([0.5, 0.5], [0.6, 0.4]);
    const far = histogramDistance([0.5, 0.5], [1, 0]);
    expect(far).toBeGreaterThan(near);
  });

  it("handles histograms of differing length", () => {
    expect(histogramDistance([1], [0.5, 0.5])).toBeCloseTo(0.5);
  });
});

describe("shots", () => {
  it("covers the whole file", () => {
    expect(shots([4, 10], 15)).toEqual([
      [0, 4],
      [4, 10],
      [10, 15],
    ]);
  });

  it("treats a file with no cuts as a single shot", () => {
    expect(shots([], 12)).toEqual([[0, 12]]);
  });

  it("ignores boundaries beyond the duration", () => {
    expect(shots([20], 10)).toEqual([[0, 10]]);
  });
});
