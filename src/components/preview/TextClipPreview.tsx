import type { Clip } from "@/types/timeline";
import { DEFAULT_TEXT } from "@/types/effects";

interface TextClipPreviewProps {
  clip: Clip;
}

/** Renders a text clip in the preview, mirroring the export's drawtext. */
export function TextClipPreview({ clip }: TextClipPreviewProps) {
  const text = { ...DEFAULT_TEXT, ...clip.text };

  return (
    <div className="absolute inset-0">
      <div
        className="absolute"
        style={{
          left: `${text.x * 100}%`,
          top: `${text.y * 100}%`,
          transform: `translate(${
            text.alignment === "left" ? "0" : text.alignment === "right" ? "-100%" : "-50%"
          }, -50%)`,
          opacity: clip.transform.opacity / 100,
        }}
      >
        <span
          className="whitespace-pre-line"
          style={{
            // Sized against the 1080p reference frame the export uses.
            fontSize: `${(text.fontSize / 1080) * 100}cqh`,
            fontFamily: text.fontFamily,
            color: text.color,
            backgroundColor: text.backgroundColor || "transparent",
            fontWeight: text.bold ? 700 : 400,
            WebkitTextStroke: text.outlineWidth
              ? `${text.outlineWidth}px ${text.outlineColor}`
              : undefined,
            paintOrder: "stroke fill",
          }}
        >
          {text.content}
        </span>
      </div>
    </div>
  );
}
