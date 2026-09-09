import { describe, expect, it } from "vitest";
import { colorToCssFilter } from "./preview";
import { DEFAULT_COLOR } from "@/types/color";

describe("preview colour filter", () => {
  it("produces no filter for an ungraded clip", () => {
    expect(colorToCssFilter(DEFAULT_COLOR)).toBeUndefined();
  });

  it("maps exposure onto brightness", () => {
    const filter = colorToCssFilter({ ...DEFAULT_COLOR, exposure: 50 })!;
    expect(filter).toContain("brightness(1.500)");
  });

  it("normalises saturation against its 100 default", () => {
    const filter = colorToCssFilter({ ...DEFAULT_COLOR, saturation: 150 })!;
    expect(filter).toContain("saturate(1.500)");
  });

  it("includes every stage once any parameter is set", () => {
    const filter = colorToCssFilter({ ...DEFAULT_COLOR, contrast: 10 })!;
    expect(filter).toMatch(/brightness/);
    expect(filter).toMatch(/contrast/);
    expect(filter).toMatch(/saturate/);
    expect(filter).toMatch(/hue-rotate/);
  });
});
