import { describe, expect, it } from "vitest";
import { formatDuration, formatTimecode, snapToFrame, timeEquals } from "./time";

describe("formatTimecode", () => {
  it("formats HH:MM:SS:FF", () => {
    expect(formatTimecode(0, 30)).toBe("00:00:00:00");
    expect(formatTimecode(1.5, 30)).toBe("00:00:01:15");
    expect(formatTimecode(3661, 30)).toBe("01:01:01:00");
  });

  it("never rolls the frame counter past fps", () => {
    expect(formatTimecode(0.999, 30)).toBe("00:00:01:00");
    expect(formatTimecode(2 - 1 / 30, 30)).toBe("00:00:01:29");
  });

  it("clamps a negative time to zero", () => {
    expect(formatTimecode(-5, 30)).toBe("00:00:00:00");
  });

  it("survives a non-finite time", () => {
    expect(formatTimecode(Number.NaN, 30)).toBe("00:00:00:00");
  });
});

describe("formatDuration", () => {
  it("drops the hour when it is zero", () => {
    expect(formatDuration(102)).toBe("01:42");
    expect(formatDuration(3702)).toBe("1:01:42");
  });
});

describe("snapToFrame", () => {
  it("quantizes to the frame grid", () => {
    expect(snapToFrame(1.017, 30)).toBeCloseTo(31 / 30, 6);
  });

  it("passes the time through when fps is invalid", () => {
    expect(snapToFrame(1.017, 0)).toBe(1.017);
  });
});

describe("timeEquals", () => {
  it("tolerates float drift", () => {
    expect(timeEquals(0.1 + 0.2, 0.3)).toBe(true);
    expect(timeEquals(0.3, 0.4)).toBe(false);
  });
});
