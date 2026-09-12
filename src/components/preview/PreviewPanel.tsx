import { useEffect, useMemo, useRef } from "react";
import { Panel } from "@/components/ui/Panel";
import { TransportControls } from "./TransportControls";
import { useEditorStore } from "@/store/editorStore";
import { usePlaybackStore } from "@/store/playbackStore";
import { previewUrl } from "@/services/mediaService";
import { adjustmentLayersAt, clipAt, sequenceDuration } from "@/features/timeline/engine";
import { colorToCssFilter } from "@/features/color/preview";
import { CurveFilterDefs } from "./CurveFilterDefs";
import { mergeColorStack } from "@/features/color/stack";

interface PreviewPanelProps {
  className?: string;
}

/**
 * Preview monitor (design doc section 10).
 *
 * Sequence playback is a single-element preview: the clip under the playhead on
 * the topmost visible video track is shown, seeked to its source time. Multi
 * track compositing is a renderer concern and arrives with GPU preview later.
 */
export function PreviewPanel({ className }: PreviewPanelProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const project = useEditorStore((state) => state.project);
  const sequence = useEditorStore((state) => state.sequence());
  const setPlayhead = useEditorStore((state) => state.setPlayhead);
  const source = usePlaybackStore((state) => state.source);
  const playing = usePlaybackStore((state) => state.playing);
  const rate = usePlaybackStore((state) => state.rate);
  const volume = usePlaybackStore((state) => state.volume);
  const muted = usePlaybackStore((state) => state.muted);
  const pause = usePlaybackStore((state) => state.pause);

  const active = useMemo(() => {
    if (source.kind === "media") {
      const item = project.media.find((media) => media.id === source.mediaId);
      return item ? { url: previewUrl(item), sourceTime: 0, clip: null } : null;
    }
    if (source.kind !== "sequence") return null;

    const topTrack = [...sequence.videoTracks].reverse().find((track) => !track.hidden);
    if (!topTrack) return null;

    const clip = clipAt(sequence, topTrack.id, sequence.playhead);
    if (!clip?.mediaId) return null;

    const item = project.media.find((media) => media.id === clip.mediaId);
    if (!item) return null;

    const speed = clip.speed > 0 ? clip.speed : 1;
    return {
      url: previewUrl(item),
      sourceTime: clip.sourceIn + (sequence.playhead - clip.startTime) * speed,
      clip,
    };
  }, [project.media, sequence, source]);

  // Keep the element in sync with the playhead while scrubbing.
  useEffect(() => {
    const element = videoRef.current;
    if (!element || !active || playing) return;
    if (Math.abs(element.currentTime - active.sourceTime) > 0.05) {
      element.currentTime = active.sourceTime;
    }
  }, [active, playing]);

  useEffect(() => {
    const element = videoRef.current;
    if (!element) return;
    element.playbackRate = rate;
    element.volume = volume;
    element.muted = muted;
    if (playing) void element.play().catch(() => pause());
    else element.pause();
  }, [playing, rate, volume, muted, pause, active?.url]);

  // Advance the sequence playhead from the element's clock during playback.
  useEffect(() => {
    if (!playing || source.kind !== "sequence") return;
    let frame = 0;
    let last = performance.now();

    const tick = (now: number) => {
      const delta = (now - last) / 1000;
      last = now;
      const state = useEditorStore.getState();
      const current = state.sequence();
      const next = current.playhead + delta * usePlaybackStore.getState().rate;
      if (next >= sequenceDuration(current)) {
        state.setPlayhead(sequenceDuration(current));
        usePlaybackStore.getState().pause();
        return;
      }
      state.setPlayhead(next);
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, source.kind]);

  // The clip's own grade, then every adjustment layer above it, in order.
  const graded = active?.clip
    ? mergeColorStack(active.clip.color, adjustmentLayersAt(sequence, sequence.playhead))
    : null;
  const filter = graded ? colorToCssFilter(graded) : undefined;

  return (
    <Panel
      title={source.kind === "media" ? "Source Monitor" : "Program Monitor"}
      className={className}
    >
      <div className="relative flex min-h-0 flex-1 items-center justify-center bg-black">
        <CurveFilterDefs curves={graded?.curves} />
        {active ? (
          <video
            ref={videoRef}
            key={active.url}
            src={active.url}
            className="max-h-full max-w-full"
            style={{ filter, opacity: (active.clip?.transform.opacity ?? 100) / 100 }}
            onClick={() => usePlaybackStore.getState().toggle()}
            onEnded={() => pause()}
          />
        ) : (
          <p className="text-xs text-text-muted">
            {sequence.clips.length === 0
              ? "タイムラインにクリップを追加してください"
              : "再生ヘッドの位置にクリップがありません"}
          </p>
        )}
      </div>

      <TransportControls
        sequence={sequence}
        onSeek={setPlayhead}
        duration={sequenceDuration(sequence)}
      />
    </Panel>
  );
}
