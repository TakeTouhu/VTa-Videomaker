import { useState } from "react";
import clsx from "clsx";
import type { Sequence, Track } from "@/types/timeline";
import { TimelineClip } from "./TimelineClip";
import { useEditorStore } from "@/store/editorStore";
import { clipsOnTrack, createClip } from "@/features/timeline/engine";
import * as commands from "@/features/timeline/commands";
import { MEDIA_DRAG_TYPE } from "@/components/media/dragPayload";
import { snapThresholdSeconds, xToTime } from "./geometry";
import { snapCandidates, snapTime } from "@/features/timeline/engine";

interface TimelineTrackProps {
  track: Track;
  sequence: Sequence;
  zoom: number;
}

/** One track lane. Accepts media drops from the media panel (STEP 5). */
export function TimelineTrack({ track, sequence, zoom }: TimelineTrackProps) {
  const [dropTime, setDropTime] = useState<number | null>(null);
  const dispatch = useEditorStore((state) => state.dispatch);
  const media = useEditorStore((state) => state.project.media);
  const snapEnabled = useEditorStore((state) => state.snapEnabled);

  const clips = clipsOnTrack(sequence, track.id);
  const isAudio = track.kind === "audio";

  const timeFromDrop = (event: React.DragEvent<HTMLDivElement>): number => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const raw = Math.max(0, xToTime(event.clientX - bounds.left, zoom));
    if (!snapEnabled) return raw;
    return snapTime(raw, snapCandidates(sequence), snapThresholdSeconds(zoom));
  };

  return (
    <div
      data-track-id={track.id}
      className={clsx(
        "relative border-b border-border",
        isAudio ? "bg-panel-alt/60" : "bg-panel-alt/30",
        track.locked && "opacity-60",
      )}
      style={{ height: track.height }}
      onDragOver={(event) => {
        if (track.locked) return;
        if (!event.dataTransfer.types.includes(MEDIA_DRAG_TYPE)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        setDropTime(timeFromDrop(event));
      }}
      onDragLeave={() => setDropTime(null)}
      onDrop={(event) => {
        setDropTime(null);
        if (track.locked) return;
        const mediaId = event.dataTransfer.getData(MEDIA_DRAG_TYPE);
        if (!mediaId) return;
        event.preventDefault();

        const item = media.find((candidate) => candidate.id === mediaId);
        if (!item) return;
        // An audio track takes the audio of a video file; a video track takes
        // the picture. Either way the clip references the same source media.
        if (isAudio && item.type === "image") return;

        dispatch(
          commands.addClipCommand(
            createClip({
              mediaId: item.id,
              trackId: track.id,
              startTime: timeFromDrop(event),
              sourceIn: 0,
              sourceOut: item.duration,
              withAudio: item.type !== "image",
              label: item.name,
            }),
          ),
        );
      }}
    >
      {dropTime !== null ? (
        <div
          className="pointer-events-none absolute bottom-0 top-0 w-0.5 bg-accent"
          style={{ left: dropTime * zoom }}
        />
      ) : null}

      {(sequence.transitions ?? [])
        .filter((transition) => transition.trackId === track.id)
        .map((transition) => {
          const from = clips.find((clip) => clip.id === transition.fromClipId);
          if (!from) return null;
          const centre = from.startTime + (from.sourceOut - from.sourceIn) / (from.speed || 1);
          return (
            <div
              key={transition.id}
              className="pointer-events-none absolute top-0 h-full border-x border-accent/70 bg-accent/25"
              style={{
                left: (centre - transition.duration / 2) * zoom,
                width: Math.max(transition.duration * zoom, 4),
              }}
              title={`トランジション: ${transition.type}`}
            />
          );
        })}

      {clips.map((clip) => (
        <TimelineClip
          key={clip.id}
          clip={clip}
          track={track}
          sequence={sequence}
          zoom={zoom}
        />
      ))}
    </div>
  );
}
