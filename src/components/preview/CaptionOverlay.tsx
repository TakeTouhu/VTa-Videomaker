import type { CaptionTrack } from "@/types/timeline";

interface CaptionOverlayProps {
  tracks: CaptionTrack[] | undefined;
  time: number;
}

/** Draws the active caption over the preview, matching the export styling. */
export function CaptionOverlay({ tracks, time }: CaptionOverlayProps) {
  const cues = (tracks ?? [])
    .filter((track) => track.enabled)
    .flatMap((track) =>
      track.cues
        .filter((cue) => time >= cue.start && time < cue.end)
        .map((cue) => ({ cue, style: track.style })),
    );

  if (cues.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-0">
      {cues.map(({ cue, style }) => (
        <div
          key={cue.id}
          className="absolute left-0 right-0 px-[5%]"
          style={{
            top: `${style.positionY * 100}%`,
            textAlign: style.alignment,
            transform: "translateY(-50%)",
          }}
        >
          <span
            className="inline-block whitespace-pre-line rounded px-2 py-0.5"
            style={{
              // Font size is in frame pixels; the preview is scaled, so it is
              // expressed relative to the preview height instead.
              fontSize: `${(style.fontSize / 1080) * 100}cqh`,
              fontFamily: style.fontFamily,
              color: style.color,
              backgroundColor: style.backgroundColor || "transparent",
              fontWeight: style.bold ? 700 : 400,
              WebkitTextStroke: style.outlineWidth
                ? `${style.outlineWidth}px ${style.outlineColor}`
                : undefined,
              paintOrder: "stroke fill",
            }}
          >
            {cue.text}
          </span>
        </div>
      ))}
    </div>
  );
}
