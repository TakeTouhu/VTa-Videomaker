import { describe, expect, it } from "vitest";
import { mergeColorStack } from "./stack";
import { DEFAULT_COLOR } from "@/types/color";
import type { Clip } from "@/types/timeline";
import { makeClip } from "@/features/timeline/__tests__/fixtures";

function adjustment(color: Partial<typeof DEFAULT_COLOR>): Clip {
  return makeClip({
    id: "adj",
    kind: "adjustment",
    mediaId: null,
    color: { ...DEFAULT_COLOR, ...color },
  });
}

describe("adjustment layer colour stacking", () => {
  it("returns the base grade when there are no layers", () => {
    const base = { ...DEFAULT_COLOR, exposure: 10 };
    expect(mergeColorStack(base, [])).toBe(base);
  });

  it("adds offset parameters", () => {
    const merged = mergeColorStack({ ...DEFAULT_COLOR, exposure: 10 }, [
      adjustment({ exposure: 25 }),
    ]);
    expect(merged.exposure).toBe(35);
  });

  it("multiplies saturation because it is a percentage", () => {
    const merged = mergeColorStack({ ...DEFAULT_COLOR, saturation: 50 }, [
      adjustment({ saturation: 200 }),
    ]);
    expect(merged.saturation).toBe(100);
  });

  it("stacks several layers in order", () => {
    const merged = mergeColorStack(DEFAULT_COLOR, [
      adjustment({ contrast: 10 }),
      adjustment({ contrast: 15 }),
    ]);
    expect(merged.contrast).toBe(25);
  });

  it("leaves an inert layer with no effect", () => {
    const merged = mergeColorStack({ ...DEFAULT_COLOR, exposure: 10 }, [adjustment({})]);
    expect(merged.exposure).toBe(10);
    expect(merged.saturation).toBe(DEFAULT_COLOR.saturation);
  });

  it("lets the topmost curve win", () => {
    const merged = mergeColorStack(
      { ...DEFAULT_COLOR, curves: { rgb: [{ x: 0, y: 0.2 }, { x: 1, y: 1 }] } },
      [
        adjustment({
          curves: { rgb: [{ x: 0, y: 0 }, { x: 1, y: 0.8 }] },
        }),
      ],
    );
    expect(merged.curves?.rgb?.[1]?.y).toBe(0.8);
  });

  it("does not mutate the base grade", () => {
    const base = { ...DEFAULT_COLOR, exposure: 10 };
    mergeColorStack(base, [adjustment({ exposure: 20 })]);
    expect(base.exposure).toBe(10);
  });
});
