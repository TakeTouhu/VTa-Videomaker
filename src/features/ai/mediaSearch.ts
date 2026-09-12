/** Natural language media search (design doc section 47).
 *
 * Searches the analysis index - transcript, detected labels and vision
 * descriptions - rather than filenames, so "人が笑っているところ" can find a
 * clip whose name says nothing about it.
 */

import type { MediaAnalysis } from "@/types/ai";
import type { MediaItem } from "@/types/media";
import { keywords } from "./highlightPlans";

export interface SearchHit {
  mediaId: string;
  /** Seconds into the source media. */
  time: number;
  /** Why this matched, shown next to the result. */
  reason: string;
  score: number;
}

/**
 * Ranks moments across the analysed library. Scoring is deliberately simple and
 * explainable: every hit says what matched.
 */
export function searchMedia(
  query: string,
  media: MediaItem[],
  analyses: MediaAnalysis[],
): SearchHit[] {
  const terms = keywords(query);
  if (terms.length === 0) return [];

  const known = new Set(media.map((item) => item.id));
  const hits: SearchHit[] = [];

  for (const analysis of analyses) {
    if (!known.has(analysis.mediaId)) continue;

    for (const segment of analysis.transcript) {
      const text = segment.text.toLowerCase();
      const matched = terms.filter((term) => text.includes(term));
      if (matched.length === 0) continue;
      hits.push({
        mediaId: analysis.mediaId,
        time: segment.start,
        reason: `発言: ${segment.text.slice(0, 40)}`,
        // Speech is the strongest signal: it is exact, not inferred.
        score: matched.length * 3,
      });
    }

    for (const frame of analysis.detections ?? []) {
      for (const detection of frame.detections) {
        const label = detection.label.toLowerCase();
        if (!terms.some((term) => label.includes(term) || term.includes(label))) continue;
        hits.push({
          mediaId: analysis.mediaId,
          time: frame.time,
          reason: `検出: ${detection.label}`,
          score: 2 * detection.confidence,
        });
      }
    }

    for (const description of analysis.descriptions ?? []) {
      const haystack = `${description.text} ${description.tags.join(" ")}`.toLowerCase();
      const matched = terms.filter((term) => haystack.includes(term));
      if (matched.length === 0) continue;
      hits.push({
        mediaId: analysis.mediaId,
        time: description.time,
        reason: `映像: ${description.text.slice(0, 40)}`,
        score: matched.length,
      });
    }
  }

  return mergeNearbyHits(hits).sort((a, b) => b.score - a.score);
}

/** Collapses hits within a couple of seconds of each other on the same media. */
export function mergeNearbyHits(hits: SearchHit[], windowSeconds = 2): SearchHit[] {
  const sorted = [...hits].sort(
    (a, b) => a.mediaId.localeCompare(b.mediaId) || a.time - b.time,
  );
  const merged: SearchHit[] = [];

  for (const hit of sorted) {
    const previous = merged[merged.length - 1];
    if (
      previous &&
      previous.mediaId === hit.mediaId &&
      hit.time - previous.time <= windowSeconds
    ) {
      previous.score += hit.score;
      continue;
    }
    merged.push({ ...hit });
  }
  return merged;
}
