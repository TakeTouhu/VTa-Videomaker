import { useRef, useState } from "react";
import clsx from "clsx";
import type { CurveChannel, CurvePoint } from "@/types/color";
import { CURVE_CHANNELS, LINEAR_CURVE, evaluateCurve, normalizeCurve } from "@/types/color";

interface CurveEditorProps {
  channel: CurveChannel;
  points: CurvePoint[];
  onChange: (points: CurvePoint[]) => void;
  onCommit?: () => void;
}

const SIZE = 200;
/** Points closer than this (in normalised space) are treated as the same point. */
const HIT_RADIUS = 0.04;

const CHANNEL_COLORS: Record<CurveChannel, string> = {
  rgb: "#F4F4F5",
  red: "#E06C75",
  green: "#8CC265",
  blue: "#61AFEF",
};

/**
 * Tone curve editor (design doc section 15.2).
 *
 * Drag a point to move it, click empty space to add one, right-click or
 * double-click a point to remove it. The two endpoints cannot be removed.
 */
export function CurveEditor({ channel, points, onChange, onCommit }: CurveEditorProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const sorted = normalizeCurve(points.length > 0 ? points : LINEAR_CURVE);
  const stroke = CHANNEL_COLORS[channel];

  const toNormalised = (event: { clientX: number; clientY: number }): CurvePoint => {
    const bounds = svgRef.current?.getBoundingClientRect();
    if (!bounds) return { x: 0, y: 0 };
    return {
      x: Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)),
      // SVG y grows downwards; curve output grows upwards.
      y: Math.min(1, Math.max(0, 1 - (event.clientY - bounds.top) / bounds.height)),
    };
  };

  const findPointAt = (position: CurvePoint): number =>
    sorted.findIndex(
      (point) => Math.hypot(point.x - position.x, point.y - position.y) < HIT_RADIUS,
    );

  const onPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    const position = toNormalised(event);
    const existing = findPointAt(position);

    if (existing !== -1) {
      setDragIndex(existing);
      return;
    }
    // Clicking empty space inserts a point on the curve at that input.
    const inserted = [...sorted, { x: position.x, y: position.y }];
    const next = normalizeCurve(inserted);
    onChange(next);
    setDragIndex(next.findIndex((point) => point.x === position.x));
  };

  const onPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (dragIndex === null) return;
    const position = toNormalised(event);
    const isEndpoint = dragIndex === 0 || dragIndex === sorted.length - 1;

    const moved = sorted.map((point, index) =>
      index === dragIndex
        ? // Endpoints stay pinned to their input so the curve always spans 0..1.
          { x: isEndpoint ? point.x : position.x, y: position.y }
        : point,
    );
    onChange(normalizeCurve(moved));
  };

  const endDrag = () => {
    if (dragIndex === null) return;
    setDragIndex(null);
    onCommit?.();
  };

  const removePoint = (index: number) => {
    if (index === 0 || index === sorted.length - 1) return;
    onChange(sorted.filter((_, i) => i !== index));
    onCommit?.();
  };

  // Sample the evaluated curve so the drawn line matches what the render does.
  const path = Array.from({ length: 65 }, (_, step) => {
    const x = step / 64;
    const y = evaluateCurve(sorted, x);
    return `${step === 0 ? "M" : "L"}${x * SIZE},${(1 - y) * SIZE}`;
  }).join(" ");

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      className="w-full cursor-crosshair rounded border border-border bg-bg"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerLeave={endDrag}
      onContextMenu={(event) => {
        event.preventDefault();
        const index = findPointAt(toNormalised(event));
        if (index !== -1) removePoint(index);
      }}
    >
      {[0.25, 0.5, 0.75].map((position) => (
        <g key={position} stroke="#2A2F36" strokeWidth={1}>
          <line x1={position * SIZE} y1={0} x2={position * SIZE} y2={SIZE} />
          <line x1={0} y1={position * SIZE} x2={SIZE} y2={position * SIZE} />
        </g>
      ))}
      <line x1={0} y1={SIZE} x2={SIZE} y2={0} stroke="#2A2F36" strokeDasharray="3 3" />

      <path d={path} fill="none" stroke={stroke} strokeWidth={1.5} />

      {sorted.map((point, index) => (
        <circle
          key={`${point.x}-${index}`}
          cx={point.x * SIZE}
          cy={(1 - point.y) * SIZE}
          r={4}
          fill={dragIndex === index ? stroke : "#1A1D21"}
          stroke={stroke}
          strokeWidth={1.5}
          onDoubleClick={(event) => {
            event.stopPropagation();
            removePoint(index);
          }}
        />
      ))}
    </svg>
  );
}

interface CurveChannelTabsProps {
  active: CurveChannel;
  onSelect: (channel: CurveChannel) => void;
}

export function CurveChannelTabs({ active, onSelect }: CurveChannelTabsProps) {
  return (
    <div className="flex gap-1">
      {CURVE_CHANNELS.map((channel) => (
        <button
          key={channel}
          className={clsx(
            "flex-1 rounded border px-1 py-0.5 text-2xs uppercase",
            active === channel
              ? "border-accent bg-accent-muted text-accent"
              : "border-border text-text-secondary hover:text-text",
          )}
          style={active === channel ? undefined : { color: CHANNEL_COLORS[channel] }}
          onClick={() => onSelect(channel)}
        >
          {channel === "rgb" ? "RGB" : channel.charAt(0).toUpperCase()}
        </button>
      ))}
    </div>
  );
}
