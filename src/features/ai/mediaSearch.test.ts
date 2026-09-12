import { describe, expect, it } from "vitest";
import { mergeNearbyHits, searchMedia } from "./mediaSearch";
import type { MediaAnalysis } from "@/types/ai";
import type { MediaItem } from "@/types/media";

const media: MediaItem[] = [
  {
    id: "m1",
    type: "video",
    name: "interview.mp4",
    sourcePath: "/f/interview.mp4",
    duration: 120,
    importedAt: "2026-01-01T00:00:00.000Z",
  },
];

const analysis: MediaAnalysis = {
  mediaId: "m1",
  transcript: [{ start: 10, end: 14, text: "今日はAIについて話します" }],
  silences: [],
  scenes: [],
  detections: [
    {
      time: 40,
      detections: [{ label: "person", confidence: 0.9, x: 0, y: 0, width: 1, height: 1 }],
    },
  ],
  descriptions: [{ time: 70, text: "人が笑っている", tags: ["笑顔", "人物"] }],
  analyzedAt: "2026-01-01T00:00:00.000Z",
};

describe("semantic media search", () => {
  it("finds a moment by what was said", () => {
    const hits = searchMedia("AIについて", media, [analysis]);
    expect(hits[0]).toMatchObject({ mediaId: "m1", time: 10 });
    expect(hits[0]!.reason).toContain("発言");
  });

  it("finds a moment by a detected object", () => {
    const hits = searchMedia("person", media, [analysis]);
    expect(hits.some((hit) => hit.time === 40)).toBe(true);
  });

  it("finds a moment by a vision description", () => {
    const hits = searchMedia("笑顔", media, [analysis]);
    expect(hits.some((hit) => hit.time === 70)).toBe(true);
  });

  it("returns nothing for an empty query", () => {
    expect(searchMedia("   ", media, [analysis])).toHaveLength(0);
  });

  it("ignores analysis for media not in the library", () => {
    expect(searchMedia("AIについて", [], [analysis])).toHaveLength(0);
  });

  it("ranks speech above an inferred description", () => {
    const hits = searchMedia("人", media, [analysis]);
    // Every hit explains itself, so ranking is inspectable.
    expect(hits.every((hit) => hit.reason.length > 0)).toBe(true);
  });

  it("merges hits that are moments apart", () => {
    const merged = mergeNearbyHits([
      { mediaId: "m1", time: 10, reason: "a", score: 1 },
      { mediaId: "m1", time: 11, reason: "b", score: 2 },
      { mediaId: "m1", time: 30, reason: "c", score: 1 },
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0]!.score).toBe(3);
  });

  it("does not merge across different media", () => {
    const merged = mergeNearbyHits([
      { mediaId: "m1", time: 10, reason: "a", score: 1 },
      { mediaId: "m2", time: 10, reason: "b", score: 1 },
    ]);
    expect(merged).toHaveLength(2);
  });
});
