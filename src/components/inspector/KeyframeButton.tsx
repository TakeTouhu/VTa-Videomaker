import clsx from "clsx";
import type { Clip } from "@/types/timeline";
import type { AnimatableProperty } from "@/types/effects";
import { useEditorStore } from "@/store/editorStore";
import * as fx from "@/features/timeline/effectCommands";
import { evaluateTrack, isAnimated } from "@/features/timeline/keyframes";

interface KeyframeButtonProps {
  clip: Clip;
  property: AnimatableProperty;
  /** Current value, used when seeding the first keyframe. */
  value: number;
}

/**
 * Stopwatch toggle next to an animatable parameter (design doc section 58).
 * Filled when the property is animated, hollow when it is static.
 */
export function KeyframeButton({ clip, property, value }: KeyframeButtonProps) {
  const dispatch = useEditorStore((state) => state.dispatch);
  const playhead = useEditorStore((state) => state.sequence().playhead);

  const animated = isAnimated(clip, property);
  const speed = clip.speed > 0 ? clip.speed : 1;
  const local = (playhead - clip.startTime) * speed;

  const track = (clip.keyframes ?? []).find((entry) => entry.property === property);
  const atPlayhead =
    track?.keyframes.some((keyframe) => Math.abs(keyframe.time - local) < 1e-3) ?? false;

  const inside = playhead >= clip.startTime && playhead < clip.startTime + (clip.sourceOut - clip.sourceIn) / speed;

  return (
    <button
      className={clsx(
        "h-3.5 w-3.5 shrink-0 rounded-full border text-[8px] leading-none",
        atPlayhead
          ? "border-accent bg-accent text-bg"
          : animated
            ? "border-accent text-accent"
            : "border-border text-text-muted hover:border-text-secondary",
        !inside && "opacity-40",
      )}
      disabled={!inside}
      title={
        atPlayhead
          ? "この位置のキーフレームを削除"
          : animated
            ? "この位置にキーフレームを追加"
            : "キーフレームを有効にする"
      }
      onClick={() =>
        dispatch(
          atPlayhead
            ? fx.removeKeyframeCommand(clip.id, property, playhead)
            : fx.addKeyframeCommand(clip.id, property, playhead, value),
        )
      }
    >
      ◆
    </button>
  );
}

/** Current animated value at the playhead, or undefined when static. */
export function animatedValue(
  clip: Clip,
  property: AnimatableProperty,
  playhead: number,
): number | undefined {
  const track = (clip.keyframes ?? []).find((entry) => entry.property === property);
  if (!track) return undefined;
  const speed = clip.speed > 0 ? clip.speed : 1;
  return evaluateTrack(track, (playhead - clip.startTime) * speed);
}
