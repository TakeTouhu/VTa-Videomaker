import type { Sequence } from "@/types/timeline";
import { formatTimecode } from "@/utils/time";
import { rulerInterval, timeToX } from "./geometry";

interface TimelineRulerProps {
  sequence: Sequence;
  zoom: number;
  width: number;
  onSeek: (event: React.MouseEvent<HTMLElement>) => void;
}

/** Time ruler; clicking or dragging on it moves the playhead. */
export function TimelineRuler({ sequence, zoom, width, onSeek }: TimelineRulerProps) {
  const interval = rulerInterval(zoom);
  const count = Math.ceil(width / Math.max(timeToX(interval, zoom), 1));

  return (
    <div
      className="sticky top-0 z-10 h-6 cursor-pointer border-b border-border bg-panel-alt"
      onMouseDown={(event) => {
        onSeek(event);
        const onMove = (moveEvent: MouseEvent) =>
          onSeek(moveEvent as unknown as React.MouseEvent<HTMLElement>);
        const onUp = () => {
          window.removeEventListener("mousemove", onMove);
          window.removeEventListener("mouseup", onUp);
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
      }}
    >
      {Array.from({ length: count }, (_, index) => {
        const time = index * interval;
        return (
          <div
            key={index}
            className="absolute top-0 h-full border-l border-border pl-1 text-2xs text-text-muted"
            style={{ left: timeToX(time, zoom) }}
          >
            <span className="font-mono">{formatTimecode(time, sequence.fps)}</span>
          </div>
        );
      })}
    </div>
  );
}
