import { useCallback, useRef } from "react";
import { Panel } from "@/components/ui/Panel";
import { TimelineToolbar } from "./TimelineToolbar";
import { TimelineRuler } from "./TimelineRuler";
import { TimelineTrack } from "./TimelineTrack";
import { TrackHead } from "./TrackHead";
import { useEditorStore } from "@/store/editorStore";
import { useUIStore } from "@/store/uiStore";
import { sequenceDuration } from "@/features/timeline/engine";
import { timeToX, xToTime } from "./geometry";

interface TimelinePanelProps {
  className?: string;
}

export const TRACK_HEAD_WIDTH = 96;

/** Timeline panel: the centre of the application (design doc sections 11-12). */
export function TimelinePanel({ className }: TimelinePanelProps) {
  const sequence = useEditorStore((state) => state.sequence());
  const setPlayhead = useEditorStore((state) => state.setPlayhead);
  const clearSelection = useEditorStore((state) => state.clearSelection);
  const zoom = useUIStore((state) => state.zoom);
  const scrollRef = useRef<HTMLDivElement>(null);

  const duration = sequenceDuration(sequence);
  // Always leave a screen of empty timeline to drop new material into.
  const contentWidth = Math.max(timeToX(duration, zoom) + 600, 1200);

  const seekFromEvent = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      const container = scrollRef.current;
      if (!container) return;
      const bounds = container.getBoundingClientRect();
      const x = event.clientX - bounds.left + container.scrollLeft;
      setPlayhead(Math.max(0, xToTime(x, zoom)));
    },
    [setPlayhead, zoom],
  );

  const tracks = [...sequence.videoTracks].reverse();

  return (
    <Panel title="Timeline" className={className}>
      <TimelineToolbar />

      <div className="flex min-h-0 flex-1">
        {/* Track heads stay pinned while the timeline scrolls. */}
        <div
          className="shrink-0 border-r border-border bg-panel-alt"
          style={{ width: TRACK_HEAD_WIDTH }}
        >
          <div className="h-6 border-b border-border" />
          {tracks.map((track) => (
            <TrackHead key={track.id} track={track} />
          ))}
          {sequence.audioTracks.map((track) => (
            <TrackHead key={track.id} track={track} />
          ))}
        </div>

        <div
          ref={scrollRef}
          className="relative min-w-0 flex-1 overflow-auto"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) clearSelection();
          }}
        >
          <div style={{ width: contentWidth }} className="relative">
            <TimelineRuler
              sequence={sequence}
              zoom={zoom}
              width={contentWidth}
              onSeek={seekFromEvent}
            />

            {tracks.map((track) => (
              <TimelineTrack key={track.id} track={track} sequence={sequence} zoom={zoom} />
            ))}
            {sequence.audioTracks.map((track) => (
              <TimelineTrack key={track.id} track={track} sequence={sequence} zoom={zoom} />
            ))}

            {/* Playhead */}
            <div
              className="pointer-events-none absolute bottom-0 top-0 w-px bg-accent"
              style={{ left: timeToX(sequence.playhead, zoom) }}
            >
              <div className="-ml-[5px] h-3 w-[11px] rounded-b-sm bg-accent" />
            </div>
          </div>
        </div>
      </div>
    </Panel>
  );
}
