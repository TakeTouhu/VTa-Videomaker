/** AI Caption generation (design doc section 57) and SRT export.
 *
 * Captions are derived from the transcript and stored on the sequence, so the
 * caption editor can restyle and retime them without touching clips.
 */

import type { MediaAnalysis } from "@/types/ai";
import type { CaptionCue, CaptionStyle, Sequence } from "@/types/timeline";
import { DEFAULT_CAPTION_STYLE } from "@/types/timeline";
import { segmentsOnTimeline } from "./transcriptPlans";
import { createId } from "@/utils/id";

export interface CaptionOptions {
  /** Hard wrap beyond this many characters per line. */
  maxCharsPerLine: number;
  /** At most this many lines per cue; longer text is split into more cues. */
  maxLines: number;
  /** A cue is never shown for less than this, even if the speech is shorter. */
  minDurationSeconds: number;
}

export const DEFAULT_CAPTION_OPTIONS: CaptionOptions = {
  maxCharsPerLine: 22,
  maxLines: 2,
  minDurationSeconds: 1.0,
};

/** Builds caption cues from the transcript, in sequence time. */
export function buildCaptions(
  sequence: Sequence,
  analyses: MediaAnalysis[],
  options: CaptionOptions = DEFAULT_CAPTION_OPTIONS,
): CaptionCue[] {
  const segments = segmentsOnTimeline(sequence, analyses);
  const cues: CaptionCue[] = [];

  for (const segment of segments) {
    const chunks = splitForCaption(segment.text, options);
    if (chunks.length === 0) continue;

    const span = Math.max(segment.end - segment.start, options.minDurationSeconds);
    const each = span / chunks.length;

    chunks.forEach((chunk, index) => {
      cues.push({
        id: createId("cue"),
        start: segment.start + each * index,
        end: segment.start + each * (index + 1),
        text: chunk,
      });
    });
  }
  return cues;
}

/**
 * Wraps text to the caption width and splits it into as many cues as needed.
 * Wrapping prefers punctuation, then spaces, and only then a hard break.
 */
export function splitForCaption(text: string, options: CaptionOptions): string[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];

  const lines = wrapLines(trimmed, options.maxCharsPerLine);
  const cues: string[] = [];
  for (let index = 0; index < lines.length; index += options.maxLines) {
    cues.push(lines.slice(index, index + options.maxLines).join("\n"));
  }
  return cues;
}

function wrapLines(text: string, maxChars: number): string[] {
  const lines: string[] = [];
  let current = "";

  const flush = () => {
    if (current.trim().length > 0) lines.push(current.trim());
    current = "";
  };

  for (const character of text) {
    current += character;
    const atBreak = /[、。,.!?！？]/.test(character);
    if (atBreak && current.length >= maxChars * 0.6) {
      flush();
      continue;
    }
    if (current.length >= maxChars) {
      // Prefer breaking at the last space rather than mid-word.
      const lastSpace = current.lastIndexOf(" ");
      if (lastSpace > maxChars * 0.5) {
        lines.push(current.slice(0, lastSpace).trim());
        current = current.slice(lastSpace + 1);
      } else {
        flush();
      }
    }
  }
  flush();
  return lines;
}

/** Serialises cues to SRT for delivery alongside the video. */
export function captionsToSrt(cues: CaptionCue[]): string {
  return cues
    .map(
      (cue, index) =>
        `${index + 1}\n${srtTimestamp(cue.start)} --> ${srtTimestamp(cue.end)}\n${cue.text}\n`,
    )
    .join("\n");
}

export function srtTimestamp(seconds: number): string {
  const safe = Math.max(0, seconds);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = Math.floor(safe % 60);
  const millis = Math.round((safe - Math.floor(safe)) * 1000);
  const pad = (value: number, width = 2) => String(value).padStart(width, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(secs)},${pad(millis, 3)}`;
}

/** Style merged with the defaults, so a partial style is always renderable. */
export function resolveCaptionStyle(style: Partial<CaptionStyle> | undefined): CaptionStyle {
  return { ...DEFAULT_CAPTION_STYLE, ...style };
}
