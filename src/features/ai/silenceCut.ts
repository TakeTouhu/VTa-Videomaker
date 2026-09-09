/** AI Silence Cut - the first AI feature (design doc section 70).
 *
 * Deterministic and provider-free: it turns a silence map produced by the Rust
 * analysis pipeline into a proposed edit plan. The plan still goes through the
 * ordinary schema + rule validation before it can touch the timeline.
 */

import type { EditPlan, MediaAnalysis, SilenceRange } from "@/types/ai";
import type { Sequence } from "@/types/timeline";
import * as engine from "@/features/timeline/engine";
import { createId } from "@/utils/id";
import { TIME_EPSILON as EPSILON } from "@/utils/time";

export interface SilenceCutOptions {
  /** Silences shorter than this are kept - cutting them sounds unnatural. */
  minSilenceSeconds: number;
  /** Breathing room kept on both sides of a cut. */
  paddingSeconds: number;
  /** Close the gaps left behind. */
  ripple: boolean;
}

export const DEFAULT_SILENCE_CUT_OPTIONS: SilenceCutOptions = {
  minSilenceSeconds: 0.6,
  paddingSeconds: 0.12,
  ripple: true,
};

/** Maps a source-time range onto the sequence times of the clips using it. */
function sourceRangeToSequenceRanges(
  sequence: Sequence,
  mediaId: string,
  range: SilenceRange,
): { clipId: string; start: number; end: number }[] {
  const result: { clipId: string; start: number; end: number }[] = [];
  for (const clip of sequence.clips) {
    if (clip.mediaId !== mediaId) continue;
    const speed = clip.speed > 0 ? clip.speed : 1;
    const overlapIn = Math.max(range.start, clip.sourceIn);
    const overlapOut = Math.min(range.end, clip.sourceOut);
    if (overlapOut <= overlapIn) continue;

    result.push({
      clipId: clip.id,
      start: clip.startTime + (overlapIn - clip.sourceIn) / speed,
      end: clip.startTime + (overlapOut - clip.sourceIn) / speed,
    });
  }
  return result;
}

/** Builds the "無音部分を削除" plan. */
export function buildSilenceCutPlan(
  sequence: Sequence,
  analyses: MediaAnalysis[],
  options: SilenceCutOptions = DEFAULT_SILENCE_CUT_OPTIONS,
): EditPlan {
  const actions: EditPlan["actions"] = [];
  let removedSeconds = 0;

  for (const analysis of analyses) {
    for (const silence of analysis.silences) {
      for (const range of sourceRangeToSequenceRanges(
        sequence,
        analysis.mediaId,
        silence,
      )) {
        const clip = engine.findClip(sequence, range.clipId);
        if (!clip) continue;

        const clipStart = clip.startTime;
        const clipEnd = engine.clipEnd(clip);

        // Padding protects the speech next to a cut. Where the silence runs to
        // the edge of the clip there is no neighbouring speech to protect, so
        // that side is not padded - otherwise a clip that is silent throughout
        // would survive as two unusable slivers.
        const padStart = range.start > clipStart + EPSILON ? options.paddingSeconds : 0;
        const padEnd = range.end < clipEnd - EPSILON ? options.paddingSeconds : 0;

        const start = range.start + padStart;
        const end = range.end - padEnd;
        if (end - start < options.minSilenceSeconds) continue;

        actions.push({
          type: "delete",
          clipId: range.clipId,
          start,
          end,
          ripple: options.ripple,
          reason: "無音",
        });
        removedSeconds += end - start;
      }
    }
  }

  return {
    id: createId("plan"),
    prompt: "無音部分を削除して",
    summary:
      actions.length === 0
        ? "削除できる無音部分は見つかりませんでした"
        : `${actions.length}箇所の無音（合計 ${removedSeconds.toFixed(1)} 秒）を削除します`,
    actions,
    createdAt: new Date().toISOString(),
  };
}

/** Filler words used by the "言い直しを削除" plan in Phase 3. */
export const FILLER_PATTERNS = [
  /^え+[ー〜]*$/,
  /^あの+[ー〜]*$/,
  /^その+[ー〜]*$/,
  /^ま+[ー〜]*$/,
  /^うーん$/,
  /^um+$/i,
  /^uh+$/i,
];

export function isFiller(text: string): boolean {
  const normalized = text.trim().replace(/[、。,.\s]/g, "");
  if (normalized.length === 0) return true;
  return FILLER_PATTERNS.some((pattern) => pattern.test(normalized));
}
