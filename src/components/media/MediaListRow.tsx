import clsx from "clsx";
import type { MediaItem } from "@/types/media";
import { formatDuration } from "@/utils/time";
import { MEDIA_DRAG_TYPE } from "./dragPayload";

interface MediaListRowProps {
  item: MediaItem;
  selected: boolean;
  onSelect: (mediaId: string) => void;
  onRemove: (mediaId: string) => void;
}

/** Compact list row with metadata (design doc section 8). */
export function MediaListRow({ item, selected, onSelect, onRemove }: MediaListRowProps) {
  return (
    <div
      className={clsx(
        "group flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-2xs",
        selected ? "bg-accent-muted text-text" : "hover:bg-border/40",
      )}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData(MEDIA_DRAG_TYPE, item.id);
        event.dataTransfer.effectAllowed = "copy";
      }}
      onClick={() => onSelect(item.id)}
    >
      <span
        className={clsx(
          "h-2 w-2 shrink-0 rounded-sm",
          item.type === "video" ? "bg-video" : item.type === "audio" ? "bg-audio" : "bg-adjustment",
        )}
      />
      <span className="flex-1 truncate">{item.name}</span>
      {item.width ? (
        <span className="text-text-muted">
          {item.width}×{item.height}
        </span>
      ) : null}
      <span className="font-mono text-text-muted">{formatDuration(item.duration)}</span>
      <button
        className="hidden text-text-muted group-hover:block hover:text-danger"
        onClick={(event) => {
          event.stopPropagation();
          onRemove(item.id);
        }}
      >
        ×
      </button>
    </div>
  );
}
