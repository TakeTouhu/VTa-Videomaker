/** Timeline Engine - the independent, UI-free core of the editor.
 *
 * Every function here is pure: it takes a Sequence and returns a new Sequence.
 * Nothing in this module imports React, Zustand, Tauri or FFmpeg, so the same
 * code backs manual editing, AI edit plans, and the renderer's clip layout.
 */

import type { Clip, Sequence, Track, VideoTrack } from "@/types/timeline";
import { DEFAULT_AUDIO, DEFAULT_TRANSFORM } from "@/types/timeline";
import { DEFAULT_COLOR } from "@/types/color";
import { TIME_EPSILON, clamp, snapToFrame } from "@/utils/time";
import { createId } from "@/utils/id";

export const MIN_CLIP_DURATION = 1 / 120;

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

/** Timeline duration of a clip, i.e. source range compressed by speed. */
export function clipDuration(clip: Clip): number {
  const source = Math.max(0, clip.sourceOut - clip.sourceIn);
  const speed = clip.speed > 0 ? clip.speed : 1;
  return source / speed;
}

export function clipEnd(clip: Clip): number {
  return clip.startTime + clipDuration(clip);
}

export function findClip(sequence: Sequence, clipId: string): Clip | undefined {
  return sequence.clips.find((clip) => clip.id === clipId);
}

export function tracksOf(sequence: Sequence): Track[] {
  return [...sequence.videoTracks, ...sequence.audioTracks];
}

export function findTrack(sequence: Sequence, trackId: string): Track | undefined {
  return tracksOf(sequence).find((track) => track.id === trackId);
}

export function isTrackLocked(sequence: Sequence, trackId: string): boolean {
  return findTrack(sequence, trackId)?.locked ?? false;
}

/** Clips on one track, ordered by start time. */
export function clipsOnTrack(sequence: Sequence, trackId: string): Clip[] {
  return sequence.clips
    .filter((clip) => clip.trackId === trackId)
    .sort((a, b) => a.startTime - b.startTime);
}

/** Total length of the sequence, i.e. the end of the last clip. */
export function sequenceDuration(sequence: Sequence): number {
  return sequence.clips.reduce((max, clip) => Math.max(max, clipEnd(clip)), 0);
}

/** The topmost clip covering `time` on a track, if any. */
export function clipAt(
  sequence: Sequence,
  trackId: string,
  time: number,
): Clip | undefined {
  return clipsOnTrack(sequence, trackId).find(
    (clip) => time > clip.startTime + TIME_EPSILON && time < clipEnd(clip) - TIME_EPSILON,
  );
}

function overlaps(a: Clip, b: Clip): boolean {
  return (
    a.startTime < clipEnd(b) - TIME_EPSILON && clipEnd(a) > b.startTime + TIME_EPSILON
  );
}

/* ------------------------------------------------------------------ */
/* Internal helpers                                                    */
/* ------------------------------------------------------------------ */

function withClips(sequence: Sequence, clips: Clip[]): Sequence {
  return { ...sequence, clips };
}

function replaceClip(sequence: Sequence, next: Clip): Sequence {
  return withClips(
    sequence,
    sequence.clips.map((clip) => (clip.id === next.id ? next : clip)),
  );
}

/** Source offset that corresponds to a sequence time inside the clip. */
function sourceTimeAt(clip: Clip, sequenceTime: number): number {
  const speed = clip.speed > 0 ? clip.speed : 1;
  return clip.sourceIn + (sequenceTime - clip.startTime) * speed;
}

/**
 * Resolves an incoming clip against the clips already on its track using
 * overwrite semantics: existing material under the new clip is trimmed away,
 * and a clip fully covered is removed. Returns the resulting track contents.
 */
function overwriteOnTrack(existing: Clip[], incoming: Clip): Clip[] {
  const result: Clip[] = [];
  for (const clip of existing) {
    if (clip.id === incoming.id || !overlaps(clip, incoming)) {
      if (clip.id !== incoming.id) result.push(clip);
      continue;
    }
    const start = clip.startTime;
    const end = clipEnd(clip);
    const inStart = incoming.startTime;
    const inEnd = clipEnd(incoming);

    const keepsHead = start < inStart - TIME_EPSILON;
    const keepsTail = end > inEnd + TIME_EPSILON;

    if (keepsHead) {
      result.push(trimTail(clip, inStart));
    }
    if (keepsTail) {
      const tail = trimHead({ ...clip, id: keepsHead ? createId("clip") : clip.id }, inEnd);
      result.push(tail);
    }
    // Neither head nor tail survives -> the clip is fully overwritten.
  }
  result.push(incoming);
  return result.sort((a, b) => a.startTime - b.startTime);
}

/** Shortens a clip so that it ends at `time`, keeping its head. */
function trimTail(clip: Clip, time: number): Clip {
  const speed = clip.speed > 0 ? clip.speed : 1;
  const newSourceOut = clip.sourceIn + (time - clip.startTime) * speed;
  return { ...clip, sourceOut: newSourceOut };
}

/** Shortens a clip so that it starts at `time`, keeping its tail. */
function trimHead(clip: Clip, time: number): Clip {
  const newSourceIn = sourceTimeAt(clip, time);
  return { ...clip, startTime: time, sourceIn: newSourceIn };
}

/* ------------------------------------------------------------------ */
/* Clip construction                                                   */
/* ------------------------------------------------------------------ */

export interface CreateClipInput {
  mediaId: string | null;
  trackId: string;
  startTime: number;
  sourceIn: number;
  sourceOut: number;
  kind?: Clip["kind"];
  withAudio?: boolean;
  label?: string;
  id?: string;
}

export function createClip(input: CreateClipInput): Clip {
  return {
    id: input.id ?? createId("clip"),
    mediaId: input.mediaId,
    trackId: input.trackId,
    kind: input.kind ?? "media",
    startTime: Math.max(0, input.startTime),
    sourceIn: Math.max(0, input.sourceIn),
    sourceOut: Math.max(input.sourceIn + MIN_CLIP_DURATION, input.sourceOut),
    speed: 1,
    transform: { ...DEFAULT_TRANSFORM },
    color: { ...DEFAULT_COLOR },
    audio: input.withAudio === false ? undefined : { ...DEFAULT_AUDIO },
    label: input.label,
  };
}

/**
 * Builds an adjustment layer: a clip with no source media whose colour and
 * effects apply to every visible layer beneath it (design doc section 16).
 */
export function createAdjustmentLayer(
  trackId: string,
  startTime: number,
  duration: number,
  id?: string,
): Clip {
  return {
    ...createClip({
      mediaId: null,
      trackId,
      startTime,
      sourceIn: 0,
      sourceOut: Math.max(MIN_CLIP_DURATION, duration),
      kind: "adjustment",
      withAudio: false,
      label: "Adjustment Layer",
      id,
    }),
  };
}

/** Adjustment layers covering `time`, ordered bottom track first. */
export function adjustmentLayersAt(sequence: Sequence, time: number): Clip[] {
  const order = new Map(sequence.videoTracks.map((track, index) => [track.id, index]));
  return sequence.clips
    .filter(
      (clip) =>
        clip.kind === "adjustment" &&
        time >= clip.startTime - TIME_EPSILON &&
        time < clipEnd(clip) - TIME_EPSILON &&
        !(findTrack(sequence, clip.trackId) as VideoTrack | undefined)?.hidden,
    )
    .sort((a, b) => (order.get(a.trackId) ?? 0) - (order.get(b.trackId) ?? 0));
}

/* ------------------------------------------------------------------ */
/* Mutations (pure)                                                    */
/* ------------------------------------------------------------------ */

/** Adds a clip, overwriting whatever it lands on. */
export function insertClip(sequence: Sequence, clip: Clip): Sequence {
  const sameTrack = sequence.clips.filter((c) => c.trackId === clip.trackId);
  const others = sequence.clips.filter((c) => c.trackId !== clip.trackId);
  return withClips(sequence, [...others, ...overwriteOnTrack(sameTrack, clip)]);
}

export interface MoveOptions {
  /** Target track. Defaults to the clip's current track. */
  trackId?: string;
  /** Frame-quantize the destination. */
  fps?: number;
}

/** Moves a clip to a new start time and optionally another track. */
export function moveClip(
  sequence: Sequence,
  clipId: string,
  startTime: number,
  options: MoveOptions = {},
): Sequence {
  const clip = findClip(sequence, clipId);
  if (!clip) return sequence;

  const trackId = options.trackId ?? clip.trackId;
  if (isTrackLocked(sequence, clip.trackId) || isTrackLocked(sequence, trackId)) {
    return sequence;
  }
  const target = findTrack(sequence, trackId);
  if (!target) return sequence;

  const quantized = options.fps ? snapToFrame(startTime, options.fps) : startTime;
  const moved: Clip = { ...clip, trackId, startTime: Math.max(0, quantized) };

  const sameTrack = sequence.clips.filter((c) => c.trackId === trackId && c.id !== clipId);
  const others = sequence.clips.filter((c) => c.trackId !== trackId && c.id !== clipId);
  return withClips(sequence, [...others, ...overwriteOnTrack(sameTrack, moved)]);
}

export type TrimEdge = "start" | "end";

/**
 * Trims one edge of a clip. The opposite edge and the source media bounds are
 * respected, so a clip can never be trimmed past its own material.
 */
export function trimClip(
  sequence: Sequence,
  clipId: string,
  edge: TrimEdge,
  time: number,
  mediaDuration?: number,
): Sequence {
  const clip = findClip(sequence, clipId);
  if (!clip || isTrackLocked(sequence, clip.trackId)) return sequence;

  const speed = clip.speed > 0 ? clip.speed : 1;

  if (edge === "start") {
    // Cannot move past the clip's tail, nor before the start of the source.
    const earliest = clip.startTime - clip.sourceIn / speed;
    const latest = clipEnd(clip) - MIN_CLIP_DURATION;
    const nextStart = clamp(Math.max(0, time), Math.max(0, earliest), latest);
    return replaceClip(sequence, trimHead(clip, nextStart));
  }

  const earliest = clip.startTime + MIN_CLIP_DURATION;
  const maxSourceOut = mediaDuration ?? clip.sourceOut;
  const latest = clip.startTime + (maxSourceOut - clip.sourceIn) / speed;
  const nextEnd = clamp(time, earliest, Math.max(earliest, latest));
  return replaceClip(sequence, trimTail(clip, nextEnd));
}

export interface SplitResult {
  sequence: Sequence;
  /** Ids of the two halves, in timeline order. Empty when nothing was split. */
  newClipIds: string[];
}

/** Splits one clip at a sequence time (Razor tool / section 13). */
export function splitClip(
  sequence: Sequence,
  clipId: string,
  time: number,
  newIdFactory: () => string = () => createId("clip"),
): SplitResult {
  const clip = findClip(sequence, clipId);
  if (!clip || isTrackLocked(sequence, clip.trackId)) {
    return { sequence, newClipIds: [] };
  }
  if (
    time <= clip.startTime + MIN_CLIP_DURATION ||
    time >= clipEnd(clip) - MIN_CLIP_DURATION
  ) {
    return { sequence, newClipIds: [] };
  }

  const head = trimTail(clip, time);
  const tail: Clip = { ...trimHead(clip, time), id: newIdFactory() };

  return {
    sequence: withClips(sequence, [
      ...sequence.clips.filter((c) => c.id !== clipId),
      head,
      tail,
    ]),
    newClipIds: [head.id, tail.id],
  };
}

/** Splits every unlocked clip crossing `time` on the given tracks. */
export function splitAt(
  sequence: Sequence,
  time: number,
  trackIds?: string[],
  newIdFactory: () => string = () => createId("clip"),
): SplitResult {
  const targets = sequence.clips.filter((clip) => {
    if (trackIds && !trackIds.includes(clip.trackId)) return false;
    if (isTrackLocked(sequence, clip.trackId)) return false;
    return (
      time > clip.startTime + MIN_CLIP_DURATION && time < clipEnd(clip) - MIN_CLIP_DURATION
    );
  });

  let next = sequence;
  const ids: string[] = [];
  for (const clip of targets) {
    const result = splitClip(next, clip.id, time, newIdFactory);
    next = result.sequence;
    ids.push(...result.newClipIds);
  }
  return { sequence: next, newClipIds: ids };
}

/** Lift: removes clips and leaves the gap. */
export function deleteClips(sequence: Sequence, clipIds: string[]): Sequence {
  const removable = new Set(
    sequence.clips
      .filter((clip) => clipIds.includes(clip.id) && !isTrackLocked(sequence, clip.trackId))
      .map((clip) => clip.id),
  );
  return withClips(
    sequence,
    sequence.clips.filter((clip) => !removable.has(clip.id)),
  );
}

/**
 * Ripple delete: removes clips and closes the gap on each affected track by
 * shifting later clips left. Tracks not containing a removed clip are untouched.
 */
export function rippleDeleteClips(sequence: Sequence, clipIds: string[]): Sequence {
  const removed = sequence.clips.filter(
    (clip) => clipIds.includes(clip.id) && !isTrackLocked(sequence, clip.trackId),
  );
  if (removed.length === 0) return sequence;

  let next = deleteClips(sequence, removed.map((clip) => clip.id));

  // Process each removal from the end of the timeline backwards so that the
  // shift amounts stay valid as earlier gaps close.
  const byTime = [...removed].sort((a, b) => b.startTime - a.startTime);
  for (const clip of byTime) {
    const gap = clipDuration(clip);
    if (gap <= TIME_EPSILON) continue;
    next = shiftClipsAfter(next, clip.trackId, clip.startTime, -gap);
  }
  return next;
}

/** Shifts every clip on a track that starts at or after `time` by `delta`. */
export function shiftClipsAfter(
  sequence: Sequence,
  trackId: string,
  time: number,
  delta: number,
): Sequence {
  return withClips(
    sequence,
    sequence.clips.map((clip) =>
      clip.trackId === trackId && clip.startTime >= time - TIME_EPSILON
        ? { ...clip, startTime: Math.max(0, clip.startTime + delta) }
        : clip,
    ),
  );
}

/**
 * Removes a time range from a track, splitting clips at the boundaries first.
 * This is what an AI "delete this range" action lowers to (section 70).
 */
export function removeRange(
  sequence: Sequence,
  trackId: string,
  start: number,
  end: number,
  ripple: boolean,
  newIdFactory: () => string = () => createId("clip"),
): Sequence {
  if (end - start <= TIME_EPSILON) return sequence;
  if (isTrackLocked(sequence, trackId)) return sequence;

  let next = splitAt(sequence, start, [trackId], newIdFactory).sequence;
  next = splitAt(next, end, [trackId], newIdFactory).sequence;

  const inside = clipsOnTrack(next, trackId).filter(
    (clip) =>
      clip.startTime >= start - TIME_EPSILON && clipEnd(clip) <= end + TIME_EPSILON,
  );
  if (inside.length === 0) return next;

  const ids = inside.map((clip) => clip.id);
  if (!ripple) return deleteClips(next, ids);

  next = deleteClips(next, ids);
  return shiftClipsAfter(next, trackId, end, -(end - start));
}

/** Duplicates clips, offsetting the copies to just after the source range. */
export function duplicateClips(
  sequence: Sequence,
  clipIds: string[],
  newIdFactory: () => string = () => createId("clip"),
): { sequence: Sequence; newClipIds: string[] } {
  const sources = sequence.clips.filter((clip) => clipIds.includes(clip.id));
  if (sources.length === 0) return { sequence, newClipIds: [] };

  const rangeStart = Math.min(...sources.map((clip) => clip.startTime));
  const rangeEnd = Math.max(...sources.map(clipEnd));
  const offset = rangeEnd - rangeStart;

  let next = sequence;
  const newIds: string[] = [];
  for (const source of sources) {
    const copy: Clip = {
      ...source,
      id: newIdFactory(),
      startTime: source.startTime + offset,
      transform: { ...source.transform },
      color: { ...source.color },
      audio: source.audio ? { ...source.audio } : undefined,
    };
    next = insertClip(next, copy);
    newIds.push(copy.id);
  }
  return { sequence: next, newClipIds: newIds };
}

/** Applies a partial patch to a clip. Used by the Inspector and AI actions. */
export function updateClip(
  sequence: Sequence,
  clipId: string,
  patch: Partial<Omit<Clip, "id" | "trackId">>,
): Sequence {
  const clip = findClip(sequence, clipId);
  if (!clip || isTrackLocked(sequence, clip.trackId)) return sequence;
  return replaceClip(sequence, { ...clip, ...patch });
}

/* ------------------------------------------------------------------ */
/* Snapping (section 12)                                               */
/* ------------------------------------------------------------------ */

/** Candidate snap points: clip edges on any track, playhead and origin. */
export function snapCandidates(sequence: Sequence, excludeClipIds: string[] = []): number[] {
  const points = new Set<number>([0, sequence.playhead]);
  for (const clip of sequence.clips) {
    if (excludeClipIds.includes(clip.id)) continue;
    points.add(clip.startTime);
    points.add(clipEnd(clip));
  }
  return [...points].sort((a, b) => a - b);
}

/** Snaps `time` to the nearest candidate within `threshold` seconds. */
export function snapTime(
  time: number,
  candidates: number[],
  threshold: number,
): number {
  let best = time;
  let bestDistance = threshold;
  for (const candidate of candidates) {
    const distance = Math.abs(candidate - time);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}
