import { useRef, useState } from "react";
import clsx from "clsx";
import type { Clip, Sequence, Track } from "@/types/timeline";
import { useEditorStore } from "@/store/editorStore";
import * as commands from "@/features/timeline/commands";
import {
  clipDuration,
  snapCandidates,
  snapTime,
} from "@/features/timeline/engine";
import { snapThresholdSeconds, timeToX, xToTime } from "./geometry";
import { formatDuration } from "@/utils/time";
import { ClipWaveform } from "./ClipWaveform";

interface TimelineClipProps {
  clip: Clip;
  track: Track;
  sequence: Sequence;
  zoom: number;
}

type DragMode = "move" | "trim-start" | "trim-end";

interface DragState {
  mode: DragMode;
  startX: number;
  /** Live preview offsets in seconds, committed on pointer up. */
  deltaStart: number;
  deltaEnd: number;
  targetTrackId: string;
}

/**
 * A clip on the timeline. Dragging previews locally and commits exactly one
 * undoable command on release, so a drag is a single Ctrl+Z step.
 */
export function TimelineClip({ clip, track, sequence, zoom }: TimelineClipProps) {
  const dispatch = useEditorStore((state) => state.dispatch);
  const selectClips = useEditorStore((state) => state.selectClips);
  const selected = useEditorStore((state) => state.selectedClipIds.includes(clip.id));
  const tool = useEditorStore((state) => state.tool);
  const snapEnabled = useEditorStore((state) => state.snapEnabled);
  const media = useEditorStore((state) =>
    state.project.media.find((item) => item.id === clip.mediaId),
  );

  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);

  const duration = clipDuration(clip);
  const isAudioTrack = track.kind === "audio";

  const previewStart = clip.startTime + (drag?.deltaStart ?? 0);
  const previewDuration = Math.max(
    0.02,
    duration + (drag?.deltaEnd ?? 0) - (drag?.deltaStart ?? 0),
  );

  const snap = (time: number): number =>
    snapEnabled
      ? snapTime(time, snapCandidates(sequence, [clip.id]), snapThresholdSeconds(zoom))
      : time;

  const beginDrag = (event: React.PointerEvent, mode: DragMode) => {
    if (track.locked) return;
    event.stopPropagation();
    event.preventDefault();

    const initial: DragState = {
      mode,
      startX: event.clientX,
      deltaStart: 0,
      deltaEnd: 0,
      targetTrackId: track.id,
    };
    dragRef.current = initial;
    setDrag(initial);

    const onMove = (moveEvent: PointerEvent) => {
      const current = dragRef.current;
      if (!current) return;
      const deltaSeconds = xToTime(moveEvent.clientX - current.startX, zoom);

      let next: DragState = { ...current };
      if (mode === "move") {
        const snapped = snap(clip.startTime + deltaSeconds);
        next.deltaStart = Math.max(-clip.startTime, snapped - clip.startTime);
        next.deltaEnd = next.deltaStart;

        const element = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY);
        const lane = element?.closest<HTMLElement>("[data-track-id]");
        const laneId = lane?.dataset.trackId;
        if (laneId) next.targetTrackId = laneId;
      } else if (mode === "trim-start") {
        const snapped = snap(clip.startTime + deltaSeconds);
        next.deltaStart = snapped - clip.startTime;
      } else {
        const snapped = snap(clip.startTime + duration + deltaSeconds);
        next.deltaEnd = snapped - (clip.startTime + duration);
      }

      dragRef.current = next;
      setDrag(next);
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      const final = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (!final) return;

      if (final.mode === "move") {
        if (Math.abs(final.deltaStart) < 1e-4 && final.targetTrackId === track.id) return;
        dispatch(
          commands.moveClipCommand(
            clip.id,
            clip.startTime + final.deltaStart,
            final.targetTrackId,
          ),
        );
      } else if (final.mode === "trim-start") {
        if (Math.abs(final.deltaStart) < 1e-4) return;
        dispatch(
          commands.trimClipCommand(
            clip.id,
            "start",
            clip.startTime + final.deltaStart,
            media?.duration,
          ),
        );
      } else {
        if (Math.abs(final.deltaEnd) < 1e-4) return;
        dispatch(
          commands.trimClipCommand(
            clip.id,
            "end",
            clip.startTime + duration + final.deltaEnd,
            media?.duration,
          ),
        );
      }
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const onBodyPointerDown = (event: React.PointerEvent) => {
    if (tool === "razor") {
      event.stopPropagation();
      const bounds = event.currentTarget.getBoundingClientRect();
      const time = clip.startTime + xToTime(event.clientX - bounds.left, zoom);
      dispatch(commands.splitClipCommand(clip.id, time));
      return;
    }
    selectClips([clip.id], event.shiftKey || event.ctrlKey || event.metaKey);
    beginDrag(event, "move");
  };

  return (
    <div
      className={clsx(
        "group absolute top-0.5 flex h-[calc(100%-4px)] overflow-hidden rounded-sm border text-2xs",
        clip.kind === "adjustment"
          ? "bg-adjustment/70"
          : isAudioTrack
            ? "bg-audio/70"
            : "bg-video/70",
        selected ? "border-accent" : "border-black/40",
        tool === "razor" ? "cursor-crosshair" : "cursor-grab",
        drag?.mode === "move" && "opacity-80",
      )}
      style={{
        left: timeToX(previewStart, zoom),
        width: Math.max(timeToX(previewDuration, zoom), 4),
      }}
      onPointerDown={onBodyPointerDown}
      title={`${clip.label ?? media?.name ?? "Clip"} (${formatDuration(duration)})`}
    >
      {isAudioTrack && media ? (
        <ClipWaveform
          clip={clip}
          mediaDuration={media.duration}
          width={Math.max(timeToX(previewDuration, zoom), 4)}
          height={track.height - 6}
        />
      ) : null}

      <div
        className="absolute left-0 top-0 h-full w-1.5 cursor-ew-resize bg-black/0 hover:bg-accent/70"
        onPointerDown={(event) => beginDrag(event, "trim-start")}
      />
      <span className="pointer-events-none truncate px-2 py-1 text-text">
        {clip.label ?? media?.name ?? "Clip"}
      </span>
      <div
        className="absolute right-0 top-0 h-full w-1.5 cursor-ew-resize bg-black/0 hover:bg-accent/70"
        onPointerDown={(event) => beginDrag(event, "trim-end")}
      />
    </div>
  );
}
