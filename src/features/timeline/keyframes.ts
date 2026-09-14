/** Keyframe evaluation (design doc section 58).
 *
 * Keyframe times are clip-relative, so moving or trimming a clip does not
 * shift its animation. The same evaluation backs the preview and the renderer,
 * so what is seen is what is exported.
 */

import type { AnimatableProperty, Interpolation, Keyframe, KeyframeTrack } from "@/types/effects";
import type { Clip } from "@/types/timeline";

/** Cubic ease in/out, used by the "ease" interpolation. */
function ease(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function applyInterpolation(mode: Interpolation, t: number): number {
  switch (mode) {
    case "hold":
      return 0;
    case "ease":
      return ease(t);
    case "linear":
    default:
      return t;
  }
}

/** Sorts keyframes by time; callers may insert them in any order. */
export function sortKeyframes(keyframes: Keyframe[]): Keyframe[] {
  return [...keyframes].sort((a, b) => a.time - b.time);
}

/**
 * Value of a keyframe track at `time` (clip-relative seconds).
 * Before the first and after the last keyframe the value is held.
 */
export function evaluateTrack(track: KeyframeTrack, time: number): number | undefined {
  const keyframes = sortKeyframes(track.keyframes);
  if (keyframes.length === 0) return undefined;

  const first = keyframes[0]!;
  const last = keyframes[keyframes.length - 1]!;
  if (time <= first.time) return first.value;
  if (time >= last.time) return last.value;

  for (let index = 1; index < keyframes.length; index += 1) {
    const previous = keyframes[index - 1]!;
    const current = keyframes[index]!;
    if (time > current.time) continue;

    const span = current.time - previous.time;
    if (span <= 0) return current.value;

    const t = applyInterpolation(previous.interpolation, (time - previous.time) / span);
    return previous.value + (current.value - previous.value) * t;
  }
  return last.value;
}

/** Reads the static value of an animatable property from a clip. */
export function staticValue(clip: Clip, property: AnimatableProperty): number {
  const [group, key] = property.split(".") as [string, string];
  if (group === "transform") return (clip.transform as unknown as Record<string, number>)[key] ?? 0;
  if (group === "color") return (clip.color as unknown as Record<string, number>)[key] ?? 0;
  if (group === "audio") return (clip.audio as unknown as Record<string, number> | undefined)?.[key] ?? 0;
  return 0;
}

/**
 * Resolves a clip at a point in sequence time: every animated property is
 * replaced by its keyframed value, leaving an ordinary Clip the rest of the
 * pipeline can use without knowing about animation.
 */
export function resolveClipAt(clip: Clip, sequenceTime: number): Clip {
  const tracks = clip.keyframes;
  if (!tracks || tracks.length === 0) return clip;

  const speed = clip.speed > 0 ? clip.speed : 1;
  const local = (sequenceTime - clip.startTime) * speed;

  const transform = { ...clip.transform } as unknown as Record<string, number>;
  const color = { ...clip.color } as unknown as Record<string, number>;
  const audio = clip.audio ? ({ ...clip.audio } as unknown as Record<string, number>) : undefined;
  let touched = false;

  for (const track of tracks) {
    const value = evaluateTrack(track, local);
    if (value === undefined) continue;

    const [group, key] = track.property.split(".") as [string, string];
    if (group === "transform") transform[key] = value;
    else if (group === "color") color[key] = value;
    else if (group === "audio" && audio) audio[key] = value;
    else continue;
    touched = true;
  }

  if (!touched) return clip;

  return {
    ...clip,
    transform: transform as unknown as Clip["transform"],
    color: color as unknown as Clip["color"],
    audio: audio as unknown as Clip["audio"],
  };
}

/** True when the clip animates the given property. */
export function isAnimated(clip: Clip, property: AnimatableProperty): boolean {
  return (clip.keyframes ?? []).some(
    (track) => track.property === property && track.keyframes.length > 0,
  );
}

/** Inserts or replaces a keyframe at `time` on the given property. */
export function setKeyframe(
  clip: Clip,
  property: AnimatableProperty,
  time: number,
  value: number,
  interpolation: Interpolation = "linear",
): KeyframeTrack[] {
  const tracks = clip.keyframes ?? [];
  const existing = tracks.find((track) => track.property === property);

  const keyframe: Keyframe = { time, value, interpolation };
  if (!existing) {
    return [...tracks, { property, keyframes: [keyframe] }];
  }

  const withoutSameTime = existing.keyframes.filter(
    (entry) => Math.abs(entry.time - time) > 1e-4,
  );
  return tracks.map((track) =>
    track.property === property
      ? { ...track, keyframes: sortKeyframes([...withoutSameTime, keyframe]) }
      : track,
  );
}

/** Removes the keyframe at `time`, dropping the track when it becomes empty. */
export function removeKeyframe(
  clip: Clip,
  property: AnimatableProperty,
  time: number,
): KeyframeTrack[] {
  return (clip.keyframes ?? [])
    .map((track) =>
      track.property === property
        ? {
            ...track,
            keyframes: track.keyframes.filter((entry) => Math.abs(entry.time - time) > 1e-4),
          }
        : track,
    )
    .filter((track) => track.keyframes.length > 0);
}
