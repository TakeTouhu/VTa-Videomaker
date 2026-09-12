import { useEffect, useState } from "react";
import type { Clip } from "@/types/timeline";
import { loadWaveform } from "@/services/waveformService";

interface ClipWaveformProps {
  clip: Clip;
  /** Full source duration of the media, used to slice the peaks. */
  mediaDuration: number;
  width: number;
  height: number;
}

/**
 * Waveform inside an audio clip (design doc section 36).
 *
 * The peaks cover the whole source file, so the clip renders only the slice
 * between its in and out points.
 */
export function ClipWaveform({ clip, mediaDuration, width, height }: ClipWaveformProps) {
  const [peaks, setPeaks] = useState<number[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!clip.mediaId) return;

    void loadWaveform(clip.mediaId).then((result) => {
      if (!cancelled) setPeaks(result);
    });
    return () => {
      cancelled = true;
    };
  }, [clip.mediaId]);

  if (!peaks || peaks.length === 0 || mediaDuration <= 0 || width < 2) return null;

  const startIndex = Math.floor((clip.sourceIn / mediaDuration) * peaks.length);
  const endIndex = Math.ceil((clip.sourceOut / mediaDuration) * peaks.length);
  const slice = peaks.slice(Math.max(0, startIndex), Math.min(peaks.length, endIndex));
  if (slice.length === 0) return null;

  // One polyline point per horizontal pixel, mirrored around the centre.
  const columns = Math.max(1, Math.min(Math.floor(width), slice.length));
  const half = height / 2;
  const points: string[] = [];
  const mirrored: string[] = [];

  for (let column = 0; column < columns; column += 1) {
    const from = Math.floor((column * slice.length) / columns);
    const to = Math.max(from + 1, Math.floor(((column + 1) * slice.length) / columns));
    let peak = 0;
    for (let index = from; index < to && index < slice.length; index += 1) {
      peak = Math.max(peak, slice[index] ?? 0);
    }
    const x = (column / Math.max(1, columns - 1)) * width;
    points.push(`${x.toFixed(1)},${(half - peak * half * 0.92).toFixed(1)}`);
    mirrored.unshift(`${x.toFixed(1)},${(half + peak * half * 0.92).toFixed(1)}`);
  }

  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden
    >
      <polygon
        points={[...points, ...mirrored].join(" ")}
        fill="rgba(244,244,245,0.35)"
      />
    </svg>
  );
}
