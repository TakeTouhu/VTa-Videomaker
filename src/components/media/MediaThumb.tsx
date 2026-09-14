import { useRef, useState } from "react";
import clsx from "clsx";
import type { MediaItem } from "@/types/media";
import { formatDuration } from "@/utils/time";
import { previewUrl } from "@/services/mediaService";
import { MEDIA_DRAG_TYPE } from "./dragPayload";

interface MediaThumbProps {
  item: MediaItem;
  selected: boolean;
  onSelect: (mediaId: string) => void;
  onRemove: (mediaId: string) => void;
}

/** Grid tile with hover scrubbing preview (design doc section 9). */
export function MediaThumb({ item, selected, onSelect, onRemove }: MediaThumbProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [hovering, setHovering] = useState(false);

  const startHoverPreview = () => {
    setHovering(true);
    const element = videoRef.current;
    if (!element) return;
    element.currentTime = 0;
    element.muted = true;
    void element.play().catch(() => undefined);
  };

  const stopHoverPreview = () => {
    setHovering(false);
    videoRef.current?.pause();
  };

  return (
    <div
      className={clsx(
        "group cursor-pointer overflow-hidden rounded border bg-panel-alt",
        selected ? "border-accent" : "border-border hover:border-border-strong",
      )}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData(MEDIA_DRAG_TYPE, item.id);
        event.dataTransfer.effectAllowed = "copy";
      }}
      onClick={() => onSelect(item.id)}
      onMouseEnter={startHoverPreview}
      onMouseLeave={stopHoverPreview}
      title={item.name}
    >
      <div className="relative aspect-video bg-bg">
        {item.type === "video" ? (
          <video
            ref={videoRef}
            className={clsx("h-full w-full object-contain", !hovering && "opacity-90")}
            src={previewUrl(item)}
            poster={item.thumbnailPath}
            preload="metadata"
            muted
          />
        ) : (
          <div className="flex h-full items-center justify-center text-2xs uppercase text-text-muted">
            {item.type}
          </div>
        )}
        <button
          className="absolute right-1 top-1 hidden rounded bg-bg/80 px-1 text-2xs text-text-muted group-hover:block hover:text-danger"
          onClick={(event) => {
            event.stopPropagation();
            onRemove(item.id);
          }}
          title="削除"
        >
          ×
        </button>
      </div>
      <div className="flex items-center justify-between gap-1 px-1.5 py-1">
        <span className="truncate text-2xs text-text-secondary">{item.name}</span>
        <span className="font-mono text-2xs text-text-muted">
          {formatDuration(item.duration)}
        </span>
      </div>
    </div>
  );
}
