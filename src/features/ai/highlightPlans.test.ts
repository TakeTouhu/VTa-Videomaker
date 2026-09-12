import { describe, expect, it } from "vitest";
import {
  buildAudioCorrectionPlan,
  buildBestTakePlan,
  buildColorCorrectionPlan,
  buildHighlightPlan,
  findBrollCandidates,
  groupTakes,
  keywords,
  suggestColorSettings,
  suggestGain,
  takeScore,
} from "./highlightPlans";
import type { MediaAnalysis, TranscriptSegment } from "@/types/ai";
import { makeClip, makeSequence } from "@/features/timeline/__tests__/fixtures";
import { segmentsOnTimeline } from "./transcriptPlans";

function analysis(
  transcript: TranscriptSegment[],
  extra: Partial<MediaAnalysis> = {},
): MediaAnalysis {
  return {
    mediaId: "m1",
    transcript,
    silences: [],
    scenes: [],
    analyzedAt: "2026-01-01T00:00:00.000Z",
    ...extra,
  };
}

const sequence = makeSequence([
  makeClip({ id: "c1", mediaId: "m1", startTime: 0, sourceIn: 0, sourceOut: 60 }),
]);

describe("best take detection", () => {
  const takes = analysis([
    { start: 1, end: 4, text: "今日はAIについて説明し、えー" },
    { start: 5, end: 9, text: "今日はAIについて説明します" },
    { start: 12, end: 16, text: "まったく別の話題に移ります" },
  ]);

  it("groups repeated attempts at the same line", () => {
    const groups = groupTakes(segmentsOnTimeline(sequence, [takes]));
    expect(groups).toHaveLength(2);
    expect(groups[0]).toHaveLength(2);
  });

  it("keeps the most fluent take", () => {
    const plan = buildBestTakePlan(sequence, [takes]);
    expect(plan.actions).toHaveLength(1);
    const action = plan.actions[0]!;
    if (action.type !== "delete") throw new Error("expected a delete");
    // The hesitant first attempt is the one removed.
    expect(action.start).toBe(1);
  });

  it("penalises hesitations when scoring a take", () => {
    const clean = takeScore({ clipId: "c1", start: 0, end: 1, text: "説明します" });
    const hesitant = takeScore({ clipId: "c1", start: 0, end: 1, text: "えー説明します" });
    expect(clean).toBeGreaterThan(hesitant);
  });

  it("does nothing when there are no repeats", () => {
    const plan = buildBestTakePlan(
      sequence,
      [analysis([{ start: 0, end: 2, text: "ひとつめ" }, { start: 3, end: 5, text: "ふたつめの話" }])],
    );
    expect(plan.actions).toHaveLength(0);
    expect(plan.summary).toContain("見つかりませんでした");
  });

  it("does not group takes that are far apart in time", () => {
    const groups = groupTakes(
      segmentsOnTimeline(
        sequence,
        [analysis([
          { start: 0, end: 2, text: "同じ話をします" },
          { start: 50, end: 52, text: "同じ話をします" },
        ])],
      ),
    );
    expect(groups).toHaveLength(2);
  });
});

describe("auto highlight", () => {
  const speech = analysis([
    { start: 0, end: 4, text: "つまり結論はこうです、ここが最重要ポイントです" },
    { start: 20, end: 30, text: "あー、えーと、そうですね" },
    { start: 40, end: 44, text: "まとめると次のようになります" },
  ]);

  it("keeps the best segments within the budget", () => {
    const plan = buildHighlightPlan(sequence, [speech], 10);
    expect(plan.actions.length).toBeGreaterThan(0);
    expect(plan.summary).toContain("ハイライト");
  });

  it("removes everything outside the kept segments", () => {
    const plan = buildHighlightPlan(sequence, [speech], 10);
    expect(plan.actions.every((action) => action.reason === "ハイライト外")).toBe(true);
  });

  it("refuses to guess without a transcript", () => {
    const plan = buildHighlightPlan(sequence, [analysis([])], 10);
    expect(plan.actions).toHaveLength(0);
    expect(plan.summary).toContain("文字起こしがない");
  });

  it("reports when the target is too short to keep anything", () => {
    const plan = buildHighlightPlan(sequence, [speech], 0.5);
    expect(plan.actions).toHaveLength(0);
    expect(plan.summary).toContain("短すぎて");
  });
});

describe("AI colour correction", () => {
  it("brightens and warms dark, blue footage", () => {
    const settings = suggestColorSettings({
      lumaAverage: 40,
      lumaLow: 10,
      lumaHigh: 120,
      saturation: 70,
      blueBias: 10,
    });
    expect(settings.exposure!).toBeGreaterThan(0);
    expect(settings.temperature!).toBeGreaterThan(0);
  });

  it("stays inside the safe range for extreme measurements", () => {
    const settings = suggestColorSettings({
      lumaAverage: 0,
      lumaLow: 0,
      lumaHigh: 0,
      saturation: 0.001,
      blueBias: 1000,
    });
    expect(settings.exposure!).toBeLessThanOrEqual(40);
    expect(settings.temperature!).toBeLessThanOrEqual(30);
    expect(settings.saturation!).toBeLessThanOrEqual(140);
  });

  it("applies the correction to every clip of the analysed media", () => {
    const two = makeSequence([
      makeClip({ id: "c1", mediaId: "m1", startTime: 0, sourceOut: 10 }),
      makeClip({ id: "c2", mediaId: "m1", startTime: 10, sourceIn: 10, sourceOut: 20 }),
    ]);
    const plan = buildColorCorrectionPlan(two, [
      analysis([], {
        frameStats: { lumaAverage: 40, lumaLow: 10, lumaHigh: 120, saturation: 70, blueBias: 0 },
      }),
    ]);
    expect(plan.actions).toHaveLength(2);
    expect(plan.actions.every((action) => action.type === "color")).toBe(true);
  });

  it("says so when there is nothing measured", () => {
    const plan = buildColorCorrectionPlan(sequence, [analysis([])]);
    expect(plan.actions).toHaveLength(0);
    expect(plan.summary).toContain("解析結果がありません");
  });
});

describe("AI audio correction", () => {
  it("raises a quiet clip towards the target", () => {
    expect(suggestGain(-30, -12, -16)).toBeCloseTo(11);
  });

  it("never pushes a clip into clipping", () => {
    expect(suggestGain(-30, -0.5, -16)).toBeLessThan(0);
  });

  it("proposes a volume change per analysed clip", () => {
    const plan = buildAudioCorrectionPlan(sequence, [
      analysis([], { loudness: { integratedLufs: -28, truePeakDb: -10 } }),
    ]);
    expect(plan.actions).toHaveLength(1);
    expect(plan.actions[0]!.type).toBe("volume");
  });

  it("leaves an already correct clip alone", () => {
    const plan = buildAudioCorrectionPlan(sequence, [
      analysis([], { loudness: { integratedLufs: -16.1, truePeakDb: -6 } }),
    ]);
    expect(plan.actions).toHaveLength(0);
  });
});

describe("automatic B-roll", () => {
  it("matches spoken keywords to analysed footage", () => {
    const candidates = findBrollCandidates(
      sequence,
      [analysis([{ start: 1, end: 4, text: "ここでコーヒーを淹れます" }])],
      [
        {
          mediaId: "broll1",
          transcript: [],
          silences: [],
          scenes: [],
          analyzedAt: "2026-01-01T00:00:00.000Z",
          detections: [
            {
              time: 0,
              detections: [
                { label: "コーヒー", confidence: 0.9, x: 0, y: 0, width: 1, height: 1 },
              ],
            },
          ],
        },
      ],
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.mediaId).toBe("broll1");
  });

  it("does not offer footage already on the timeline", () => {
    const candidates = findBrollCandidates(
      sequence,
      [analysis([{ start: 1, end: 4, text: "コーヒーの話" }])],
      [
        {
          mediaId: "m1",
          transcript: [],
          silences: [],
          scenes: [],
          analyzedAt: "2026-01-01T00:00:00.000Z",
          descriptions: [{ time: 0, text: "コーヒー", tags: ["コーヒー"] }],
        },
      ],
    );
    expect(candidates).toHaveLength(0);
  });

  it("extracts content words", () => {
    expect(keywords("コーヒーを淹れます。")).toContain("コーヒーを淹れ");
    expect(keywords("a b")).toHaveLength(0);
  });
});
