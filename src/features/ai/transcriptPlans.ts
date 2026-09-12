/** Transcript-driven edit plans (design doc sections 21, 24).
 *
 * These are deterministic: given the same transcript they always produce the
 * same cut. They run without a model, which makes them fast, free and testable.
 */

import type { EditPlan, MediaAnalysis, TranscriptSegment } from "@/types/ai";
import type { Sequence } from "@/types/timeline";
import * as engine from "@/features/timeline/engine";
import { createId } from "@/utils/id";
import { isFiller } from "./silenceCut";

/** A transcript segment mapped onto the timeline. */
export interface TimelineSegment {
  clipId: string;
  start: number;
  end: number;
  text: string;
  confidence?: number;
}

/** Maps every transcript segment onto the clips that use its media. */
export function segmentsOnTimeline(
  sequence: Sequence,
  analyses: MediaAnalysis[],
): TimelineSegment[] {
  const result: TimelineSegment[] = [];

  for (const analysis of analyses) {
    for (const segment of analysis.transcript) {
      for (const clip of sequence.clips) {
        if (clip.mediaId !== analysis.mediaId) continue;
        const speed = clip.speed > 0 ? clip.speed : 1;
        const overlapIn = Math.max(segment.start, clip.sourceIn);
        const overlapOut = Math.min(segment.end, clip.sourceOut);
        if (overlapOut <= overlapIn) continue;

        result.push({
          clipId: clip.id,
          start: clip.startTime + (overlapIn - clip.sourceIn) / speed,
          end: clip.startTime + (overlapOut - clip.sourceIn) / speed,
          text: segment.text,
          confidence: segment.confidence,
        });
      }
    }
  }
  return result.sort((a, b) => a.start - b.start);
}

function plan(
  prompt: string,
  summary: string,
  actions: EditPlan["actions"],
): EditPlan {
  return {
    id: createId("plan"),
    prompt,
    summary,
    actions,
    createdAt: new Date().toISOString(),
  };
}

function deleteAction(segment: TimelineSegment, reason: string): EditPlan["actions"][number] {
  return {
    type: "delete",
    clipId: segment.clipId,
    start: segment.start,
    end: segment.end,
    ripple: true,
    reason,
  };
}

/* ------------------------------------------------------------------ */
/* Filler and restated-line removal                                    */
/* ------------------------------------------------------------------ */

/** Normalised form used to decide whether two lines say the same thing. */
export function normaliseForComparison(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s、。,.!?！？「」『』…ー~]/g, "")
    .trim();
}

/**
 * Similarity in 0..1 by longest common subsequence over normalised text.
 * Restated lines rarely match exactly, so an exact comparison misses them.
 */
export function similarity(a: string, b: string): number {
  const left = normaliseForComparison(a);
  const right = normaliseForComparison(b);
  if (left.length === 0 || right.length === 0) return 0;
  if (left === right) return 1;

  // Bounded so a long transcript cannot make this quadratic cost explode.
  const MAX = 200;
  const x = left.slice(0, MAX);
  const y = right.slice(0, MAX);

  let previous = new Array<number>(y.length + 1).fill(0);
  for (let i = 1; i <= x.length; i += 1) {
    const current = new Array<number>(y.length + 1).fill(0);
    for (let j = 1; j <= y.length; j += 1) {
      current[j] =
        x[i - 1] === y[j - 1]
          ? (previous[j - 1] ?? 0) + 1
          : Math.max(current[j - 1] ?? 0, previous[j] ?? 0);
    }
    previous = current;
  }
  return ((previous[y.length] ?? 0) * 2) / (x.length + y.length);
}

export interface FillerCutOptions {
  /** Lines at least this similar to the next one are treated as a retake. */
  restatementThreshold: number;
  /** How many following lines a retake may be compared against. */
  lookahead: number;
}

export const DEFAULT_FILLER_OPTIONS: FillerCutOptions = {
  restatementThreshold: 0.8,
  lookahead: 2,
};

/**
 * Removes filler words and restated lines, keeping the last attempt - which is
 * the one the speaker meant to keep (design doc section 21).
 */
export function buildFillerCutPlan(
  sequence: Sequence,
  analyses: MediaAnalysis[],
  options: FillerCutOptions = DEFAULT_FILLER_OPTIONS,
): EditPlan {
  const segments = segmentsOnTimeline(sequence, analyses);
  const actions: EditPlan["actions"] = [];
  let fillers = 0;
  let restatements = 0;

  segments.forEach((segment, index) => {
    if (isFiller(segment.text)) {
      actions.push(deleteAction(segment, "フィラー"));
      fillers += 1;
      return;
    }

    // Compare against the next few lines; a match means this was a false start.
    for (let ahead = 1; ahead <= options.lookahead; ahead += 1) {
      const next = segments[index + ahead];
      if (!next || next.clipId !== segment.clipId) break;
      if (similarity(segment.text, next.text) >= options.restatementThreshold) {
        actions.push(deleteAction(segment, "言い直し"));
        restatements += 1;
        return;
      }
    }
  });

  const summary =
    actions.length === 0
      ? "削除できるフィラーや言い直しは見つかりませんでした"
      : `フィラー${fillers}箇所、言い直し${restatements}箇所を削除します`;

  return plan("言い直しを削除して", summary, actions);
}

/* ------------------------------------------------------------------ */
/* Condense to a target length                                         */
/* ------------------------------------------------------------------ */

export interface CondenseOptions {
  /** Silence between speech is removed first, before dropping any speech. */
  removeGaps: boolean;
  /** Keep at least this much of a gap so cuts do not sound clipped. */
  gapPaddingSeconds: number;
  /**
   * Fraction of spoken time that must survive. An unreachable target must not
   * turn into "delete everything" - the plan stops and reports the shortfall
   * instead, so the user can lower the target or cut by hand.
   */
  minKeepRatio: number;
}

export const DEFAULT_CONDENSE_OPTIONS: CondenseOptions = {
  removeGaps: true,
  gapPaddingSeconds: 0.15,
  minKeepRatio: 0.25,
};

/** Scores how worth keeping a line is. Higher is kept longer. */
export function segmentImportance(segment: TimelineSegment): number {
  const text = segment.text.trim();
  if (text.length === 0) return 0;

  const duration = Math.max(0.01, segment.end - segment.start);
  // Density of speech: a long pause with few words is cheap to cut.
  const density = text.length / duration;
  // Questions and conclusions usually carry the point of a section.
  const emphasis = /[?？]|重要|ポイント|つまり|まとめ|結論|注意/.test(text) ? 1.35 : 1;
  const confidence = segment.confidence ?? 1;

  return density * emphasis * confidence;
}

/**
 * Condenses the sequence towards `targetSeconds` (design doc section 24).
 *
 * Gaps between speech go first; only if that is not enough are the least
 * important lines dropped, lowest score first.
 */
export function buildCondensePlan(
  sequence: Sequence,
  analyses: MediaAnalysis[],
  targetSeconds: number,
  options: CondenseOptions = DEFAULT_CONDENSE_OPTIONS,
): EditPlan {
  const total = engine.sequenceDuration(sequence);
  const segments = segmentsOnTimeline(sequence, analyses);
  const promptText = `${Math.round(targetSeconds)}秒以内にまとめて`;

  if (total <= targetSeconds) {
    return plan(
      promptText,
      `すでに ${formatSeconds(total)} で目標を下回っています。変更はありません`,
      [],
    );
  }
  if (segments.length === 0) {
    return plan(
      promptText,
      "文字起こしがないため、どこを残すか判断できません。先に音声解析を実行してください",
      [],
    );
  }

  let excess = total - targetSeconds;
  const actions: EditPlan["actions"] = [];
  let gapSeconds = 0;

  if (options.removeGaps) {
    for (const gap of gapsBetween(segments, sequence)) {
      if (excess <= 0) break;
      const start = gap.start + options.gapPaddingSeconds;
      const end = gap.end - options.gapPaddingSeconds;
      const length = end - start;
      if (length <= 0.2) continue;

      const take = Math.min(length, excess);
      actions.push(
        deleteAction({ ...gap, start, end: start + take, text: "" }, "間"),
      );
      excess -= take;
      gapSeconds += take;
    }
  }

  // Still too long: drop whole lines, least important first, but never below
  // the floor of spoken material that must survive.
  const dropped: TimelineSegment[] = [];
  if (excess > 0) {
    const spokenTotal = segments.reduce(
      (sum, segment) => sum + (segment.end - segment.start),
      0,
    );
    const droppable = spokenTotal * (1 - options.minKeepRatio);
    let droppedSeconds = 0;

    const ranked = [...segments].sort(
      (a, b) => segmentImportance(a) - segmentImportance(b),
    );
    for (const segment of ranked) {
      if (excess <= 0) break;
      const length = segment.end - segment.start;
      if (droppedSeconds + length > droppable) continue;

      actions.push(deleteAction(segment, "重要度が低い"));
      dropped.push(segment);
      droppedSeconds += length;
      excess -= length;
    }
  }

  const parts = [`目標 ${formatSeconds(targetSeconds)}`];
  if (gapSeconds > 0) parts.push(`間を ${gapSeconds.toFixed(1)} 秒削除`);
  if (dropped.length > 0) parts.push(`発言 ${dropped.length} 箇所を削除`);
  const shortfall = excess > 0 ? `（${formatSeconds(excess)} 分は目標に届きません）` : "";

  return plan(promptText, `${parts.join(" / ")}${shortfall}`, actions);
}

/** Silent stretches between consecutive spoken segments on the same clip. */
function gapsBetween(
  segments: TimelineSegment[],
  sequence: Sequence,
): TimelineSegment[] {
  const gaps: TimelineSegment[] = [];

  for (let index = 1; index < segments.length; index += 1) {
    const previous = segments[index - 1]!;
    const current = segments[index]!;
    if (previous.clipId !== current.clipId) continue;
    if (current.start - previous.end <= 0.3) continue;

    gaps.push({
      clipId: current.clipId,
      start: previous.end,
      end: current.start,
      text: "",
    });
  }

  // Longest gaps first: they buy the most time per cut.
  gaps.sort((a, b) => b.end - b.start - (a.end - a.start));
  return gaps.filter((gap) => engine.findClip(sequence, gap.clipId));
}

function formatSeconds(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)}秒`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}分${Math.round(seconds % 60)}秒`;
}

/** Re-exported so callers can build a transcript without importing the type. */
export type { TranscriptSegment };
