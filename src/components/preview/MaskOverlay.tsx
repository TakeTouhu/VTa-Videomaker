import type { Clip } from "@/types/timeline";
import type { Mask } from "@/types/effects";

interface MaskOverlayProps {
  clip: Clip | null;
  time: number;
}

/**
 * Draws mask outlines over the preview so the user can see what a mask covers,
 * including its tracked position at the current time (design doc section 17).
 */
export function MaskOverlay({ clip, time }: MaskOverlayProps) {
  const masks = clip?.masks?.filter((mask) => mask.enabled) ?? [];
  if (!clip || masks.length === 0) return null;

  const speed = clip.speed > 0 ? clip.speed : 1;
  const local = (time - clip.startTime) * speed;

  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox="0 0 1 1"
      preserveAspectRatio="none"
      aria-hidden
    >
      {masks.map((mask) => {
        const [dx, dy] = trackedOffset(mask, local);
        return (
          <g key={mask.id} transform={`translate(${dx} ${dy})`}>
            {renderShape(mask)}
          </g>
        );
      })}
    </svg>
  );
}

/** Interpolates the tracker samples at `time` (clip-relative seconds). */
export function trackedOffset(mask: Mask, time: number): [number, number] {
  const samples = mask.track;
  if (samples.length === 0) return [0, 0];

  const first = samples[0]!;
  const last = samples[samples.length - 1]!;
  if (time <= first.time) return [first.offsetX, first.offsetY];
  if (time >= last.time) return [last.offsetX, last.offsetY];

  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1]!;
    const current = samples[index]!;
    if (time > current.time) continue;

    const span = current.time - previous.time;
    const t = span > 0 ? (time - previous.time) / span : 0;
    return [
      previous.offsetX + (current.offsetX - previous.offsetX) * t,
      previous.offsetY + (current.offsetY - previous.offsetY) * t,
    ];
  }
  return [last.offsetX, last.offsetY];
}

function renderShape(mask: Mask) {
  const stroke = { stroke: "#4CC2A5", strokeWidth: 0.003, fill: "none" as const };

  switch (mask.shape.kind) {
    case "rectangle":
      return (
        <rect
          x={mask.shape.x}
          y={mask.shape.y}
          width={mask.shape.width}
          height={mask.shape.height}
          rx={mask.shape.cornerRadius}
          strokeDasharray="0.01 0.008"
          {...stroke}
        />
      );
    case "ellipse":
      return (
        <ellipse
          cx={mask.shape.x}
          cy={mask.shape.y}
          rx={mask.shape.radiusX}
          ry={mask.shape.radiusY}
          strokeDasharray="0.01 0.008"
          {...stroke}
        />
      );
    case "polygon":
      return (
        <polygon
          points={mask.shape.points.map((point) => `${point.x},${point.y}`).join(" ")}
          strokeDasharray="0.01 0.008"
          {...stroke}
        />
      );
  }
}
