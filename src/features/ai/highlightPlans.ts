/** Phase 4 planners: best take, auto highlight, B-roll and corrections
 *  (design doc section 57).
 *
 * Each turns analysis data into an ordinary EditPlan, so everything goes
 * through the same validation and undo path as a manual edit.
 */

import type { EditPlan, MediaAnalysis } from "@/types/ai";
import type { Sequence } from "@/types/timeline";
import type { ColorSettings } from "@/types/color";
import { DEFAULT_COLOR } from "@/types/color";
import * as engine from "@/features/timeline/engine";
import { createId } from "@/utils/id";
import { segmentImportance, segmentsOnTimeline, similarity } from "./transcriptPlans";
import type { TimelineSegment } from "./transcriptPlans";

function plan(prompt: string, summary: string, actions: EditPlan["actions"]): EditPlan {
  return {
    id: createId("plan"),
    prompt,
    summary,
    actions,
    createdAt: new Date().toISOString(),
  };
}

/* ------------------------------------------------------------------ */
/* Best take detection                                                 */
/* ------------------------------------------------------------------ */

export interface BestTakeOptions {
  /** How similar two lines must be to count as takes of the same thing. */
  similarityThreshold: number;
  /** How far apart two takes may be, in seconds, and still be a retake. */
  maxGapSeconds: number;
}

export const DEFAULT_BEST_TAKE_OPTIONS: BestTakeOptions = {
  similarityThreshold: 0.7,
  maxGapSeconds: 30,
};

/** Groups of segments that say the same thing, in timeline order. */
export function groupTakes(
  segments: TimelineSegment[],
  options: BestTakeOptions = DEFAULT_BEST_TAKE_OPTIONS,
): TimelineSegment[][] {
  const groups: TimelineSegment[][] = [];

  for (const segment of segments) {
    const group = groups.find((candidate) => {
      const last = candidate[candidate.length - 1]!;
      if (last.clipId !== segment.clipId) return false;
      if (segment.start - last.end > options.maxGapSeconds) return false;
      return similarity(last.text, segment.text) >= options.similarityThreshold;
    });

    if (group) group.push(segment);
    else groups.push([segment]);
  }
  return groups;
}

/**
 * Scores a take. The best take is the most fluent one: longest text, fewest
 * hesitations, highest recogniser confidence.
 */
export function takeScore(segment: TimelineSegment): number {
  const text = segment.text.trim();
  const hesitations = (text.match(/え[ーえ]|あの[ーあ]|その[ーそ]|um+|uh+/gi) ?? []).length;
  const confidence = segment.confidence ?? 1;
  return text.length * confidence - hesitations * 12;
}

/** Keeps the best take of each repeated line and removes the rest. */
export function buildBestTakePlan(
  sequence: Sequence,
  analyses: MediaAnalysis[],
  options: BestTakeOptions = DEFAULT_BEST_TAKE_OPTIONS,
): EditPlan {
  const groups = groupTakes(segmentsOnTimeline(sequence, analyses), options);
  const actions: EditPlan["actions"] = [];
  let repeated = 0;

  for (const group of groups) {
    if (group.length < 2) continue;
    repeated += 1;

    const best = group.reduce((winner, candidate) =>
      takeScore(candidate) > takeScore(winner) ? candidate : winner,
    );
    for (const segment of group) {
      if (segment === best) continue;
      actions.push({
        type: "delete",
        clipId: segment.clipId,
        start: segment.start,
        end: segment.end,
        ripple: true,
        reason: "別テイクを採用",
      });
    }
  }

  return plan(
    "一番良いテイクだけ残して",
    actions.length === 0
      ? "繰り返しのテイクは見つかりませんでした"
      : `${repeated}箇所のテイクから最良のものを残し、${actions.length}箇所を削除します`,
    actions,
  );
}

/* ------------------------------------------------------------------ */
/* Auto highlight                                                      */
/* ------------------------------------------------------------------ */

/**
 * Keeps the highest scoring stretches up to `targetSeconds` and removes the
 * rest, preserving chronological order (design doc section 57).
 */
export function buildHighlightPlan(
  sequence: Sequence,
  analyses: MediaAnalysis[],
  targetSeconds: number,
): EditPlan {
  const segments = segmentsOnTimeline(sequence, analyses);
  const prompt = `ハイライトを${Math.round(targetSeconds)}秒でまとめて`;

  if (segments.length === 0) {
    return plan(
      prompt,
      "文字起こしがないため、ハイライトを判断できません。先に解析を実行してください",
      [],
    );
  }

  // Take the best segments until the budget is spent, then keep them in order.
  const ranked = [...segments].sort((a, b) => segmentImportance(b) - segmentImportance(a));
  const kept: TimelineSegment[] = [];
  let budget = targetSeconds;

  for (const segment of ranked) {
    const length = segment.end - segment.start;
    if (length > budget) continue;
    kept.push(segment);
    budget -= length;
    if (budget <= 0) break;
  }

  if (kept.length === 0) {
    return plan(prompt, "目標が短すぎて、残せる発言がありません", []);
  }

  kept.sort((a, b) => a.start - b.start);

  // Everything not kept is removed, merging adjacent removals.
  const actions: EditPlan["actions"] = [];
  const duration = engine.sequenceDuration(sequence);
  let cursor = 0;

  for (const segment of kept) {
    if (segment.start - cursor > 0.2) {
      const clip = engine.clipAt(sequence, segment.clipId, cursor) ?? null;
      actions.push({
        type: "delete",
        clipId: clip?.id ?? segment.clipId,
        start: cursor,
        end: segment.start,
        ripple: true,
        reason: "ハイライト外",
      });
    }
    cursor = Math.max(cursor, segment.end);
  }
  if (duration - cursor > 0.2) {
    const last = kept[kept.length - 1]!;
    actions.push({
      type: "delete",
      clipId: last.clipId,
      start: cursor,
      end: duration,
      ripple: true,
      reason: "ハイライト外",
    });
  }

  const total = kept.reduce((sum, segment) => sum + (segment.end - segment.start), 0);
  return plan(
    prompt,
    `${kept.length}箇所（合計 ${total.toFixed(1)} 秒）をハイライトとして残します`,
    actions,
  );
}

/* ------------------------------------------------------------------ */
/* AI colour and audio correction                                      */
/* ------------------------------------------------------------------ */

/** Applies measured colour correction to every clip of analysed media. */
export function buildColorCorrectionPlan(
  sequence: Sequence,
  analyses: MediaAnalysis[],
): EditPlan {
  const actions: EditPlan["actions"] = [];

  for (const analysis of analyses) {
    const stats = analysis.frameStats;
    if (!stats) continue;

    const color = suggestColorSettings(stats);
    for (const clip of sequence.clips) {
      if (clip.mediaId !== analysis.mediaId) continue;
      actions.push({
        type: "color",
        clipId: clip.id,
        color,
        reason: "自動色補正",
      });
    }
  }

  return plan(
    "色を自動補正して",
    actions.length === 0
      ? "色補正に必要な解析結果がありません。先に解析を実行してください"
      : `${actions.length}クリップに自動色補正を適用します`,
    actions,
  );
}

/** Mirrors the Rust-side suggestion so the preview agrees with the export. */
export function suggestColorSettings(stats: NonNullable<MediaAnalysis["frameStats"]>): Partial<ColorSettings> {
  const clamp = (value: number, min: number, max: number) =>
    Math.min(max, Math.max(min, value));

  const range = Math.max(1, stats.lumaHigh - stats.lumaLow);
  return {
    exposure: round(clamp(((110 - stats.lumaAverage) / 255) * 200, -40, 40)),
    contrast: round(clamp(((150 - range) / 150) * 60, -30, 30)),
    saturation: round(
      stats.saturation <= 0
        ? DEFAULT_COLOR.saturation
        : clamp((70 / stats.saturation) * 100, 70, 140),
    ),
    temperature: round(clamp(stats.blueBias * 1.5, -30, 30)),
  };
}

/** Broadcast-style loudness target used when normalising a sequence. */
export const TARGET_LUFS = -16;

/** Normalises every analysed clip towards the loudness target. */
export function buildAudioCorrectionPlan(
  sequence: Sequence,
  analyses: MediaAnalysis[],
  targetLufs = TARGET_LUFS,
): EditPlan {
  const actions: EditPlan["actions"] = [];

  for (const analysis of analyses) {
    const loudness = analysis.loudness;
    if (!loudness) continue;

    const gain = suggestGain(loudness.integratedLufs, loudness.truePeakDb, targetLufs);
    if (Math.abs(gain) < 0.5) continue;

    for (const clip of sequence.clips) {
      if (clip.mediaId !== analysis.mediaId || !clip.audio) continue;
      actions.push({
        type: "volume",
        clipId: clip.id,
        volume: round(clamp(clip.audio.volume + gain, -60, 12)),
        reason: "音量の自動調整",
      });
    }
  }

  return plan(
    "音量を揃えて",
    actions.length === 0
      ? "調整が必要な音量差は見つかりませんでした"
      : `${actions.length}クリップの音量を ${targetLufs} LUFS に揃えます`,
    actions,
  );
}

export function suggestGain(
  integratedLufs: number,
  truePeakDb: number,
  targetLufs: number,
): number {
  const wanted = targetLufs - integratedLufs;
  // Keep 1 dB below 0 dBTP so normalising never introduces clipping.
  const headroom = -1 - truePeakDb;
  return clamp(Math.min(wanted, headroom), -12, 12);
}

/* ------------------------------------------------------------------ */
/* Automatic B-roll                                                    */
/* ------------------------------------------------------------------ */

export interface BrollCandidate {
  mediaId: string;
  /** Sequence time where the B-roll should start. */
  start: number;
  end: number;
  /** Why this footage was chosen, shown in the plan. */
  reason: string;
}

/**
 * Matches spoken keywords against analysed footage labels and descriptions,
 * and proposes where cutaways should go (design doc section 57).
 *
 * The plan places the chosen media on the track above; the caller adds the
 * clips, because inserting new media is an add rather than an edit action.
 */
export function findBrollCandidates(
  sequence: Sequence,
  analyses: MediaAnalysis[],
  libraryAnalyses: MediaAnalysis[],
): BrollCandidate[] {
  const spoken = segmentsOnTimeline(sequence, analyses);
  const usedMedia = new Set(sequence.clips.map((clip) => clip.mediaId));
  const candidates: BrollCandidate[] = [];

  for (const segment of spoken) {
    const words = keywords(segment.text);
    if (words.length === 0) continue;

    for (const library of libraryAnalyses) {
      // Only footage that is not already on the timeline is offered.
      if (usedMedia.has(library.mediaId)) continue;

      const labels = new Set<string>([
        ...(library.detections ?? []).flatMap((frame) =>
          frame.detections.map((detection) => detection.label.toLowerCase()),
        ),
        ...(library.descriptions ?? []).flatMap((description) =>
          description.tags.map((tag) => tag.toLowerCase()),
        ),
      ]);

      // Japanese is not space-delimited, so a "word" here can be a whole
      // phrase. Matching in both directions finds "コーヒー" inside
      // "コーヒーを淹れ" without needing a morphological analyser.
      const hit = words
        .flatMap((word) =>
          [...labels].filter((label) => word.includes(label) || label.includes(word)),
        )
        .at(0);
      if (!hit) continue;

      candidates.push({
        mediaId: library.mediaId,
        start: segment.start,
        end: Math.min(segment.end, segment.start + 4),
        reason: `「${hit}」に一致する映像`,
      });
      break;
    }
  }
  return candidates;
}

/**
 * Content words, lowercased. Deliberately simple: it strips common verb endings
 * and splits on punctuation and spaces, but does no morphological analysis, so
 * a Japanese phrase stays whole. Callers match by substring for that reason.
 */
export function keywords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s、。,.!?！？「」『』・]+/)
    .map((word) => word.replace(/(です|ます|した|する|して|から|など|ので)$/u, ""))
    .filter((word) => word.length >= 2);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
