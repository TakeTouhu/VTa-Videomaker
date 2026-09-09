import clsx from "clsx";
import type { Sequence } from "@/types/timeline";
import { PLAYBACK_RATES, usePlaybackStore } from "@/store/playbackStore";
import { formatTimecode } from "@/utils/time";

interface TransportControlsProps {
  sequence: Sequence;
  duration: number;
  onSeek: (time: number) => void;
}

/** Play / stop / frame step / timecode / rate / in-out (design doc section 10). */
export function TransportControls({ sequence, duration, onSeek }: TransportControlsProps) {
  const playing = usePlaybackStore((state) => state.playing);
  const toggle = usePlaybackStore((state) => state.toggle);
  const pause = usePlaybackStore((state) => state.pause);
  const rate = usePlaybackStore((state) => state.rate);
  const setRate = usePlaybackStore((state) => state.setRate);
  const volume = usePlaybackStore((state) => state.volume);
  const setVolume = usePlaybackStore((state) => state.setVolume);
  const inPoint = usePlaybackStore((state) => state.inPoint);
  const outPoint = usePlaybackStore((state) => state.outPoint);
  const setInPoint = usePlaybackStore((state) => state.setInPoint);
  const setOutPoint = usePlaybackStore((state) => state.setOutPoint);

  const frame = 1 / sequence.fps;
  const step = (delta: number) => {
    pause();
    onSeek(Math.max(0, sequence.playhead + delta));
  };

  return (
    <div className="shrink-0 border-t border-border bg-panel-alt">
      <input
        type="range"
        className="h-1 w-full appearance-none bg-border accent-accent"
        min={0}
        max={Math.max(duration, 0.001)}
        step={frame}
        value={Math.min(sequence.playhead, duration)}
        onChange={(event) => onSeek(Number(event.target.value))}
        aria-label="シーク"
      />
      <div className="flex items-center gap-1 px-2 py-1.5">
        <button className="toolbar-button" onClick={() => onSeek(0)} title="先頭へ">
          ⏮
        </button>
        <button className="toolbar-button" onClick={() => step(-frame)} title="前フレーム">
          ◀|
        </button>
        <button
          className={clsx("toolbar-button w-9 justify-center", playing && "toolbar-button-active")}
          onClick={toggle}
          title="再生 / 一時停止 (Space)"
        >
          {playing ? "❚❚" : "▶"}
        </button>
        <button className="toolbar-button" onClick={() => step(frame)} title="次フレーム">
          |▶
        </button>

        <span className="ml-2 font-mono text-xs text-text">
          {formatTimecode(sequence.playhead, sequence.fps)}
        </span>
        <span className="font-mono text-2xs text-text-muted">
          / {formatTimecode(duration, sequence.fps)}
        </span>

        <div className="flex-1" />

        <button
          className={clsx("toolbar-button", inPoint !== null && "toolbar-button-active")}
          onClick={() => setInPoint(sequence.playhead)}
          title="In Point"
        >
          In
        </button>
        <button
          className={clsx("toolbar-button", outPoint !== null && "toolbar-button-active")}
          onClick={() => setOutPoint(sequence.playhead)}
          title="Out Point"
        >
          Out
        </button>

        <select
          className="ml-1 rounded border border-border bg-bg px-1 py-0.5 text-2xs outline-none"
          value={rate}
          onChange={(event) => setRate(Number(event.target.value))}
          aria-label="再生速度"
        >
          {PLAYBACK_RATES.map((value) => (
            <option key={value} value={value}>
              {value}×
            </option>
          ))}
        </select>

        <input
          type="range"
          className="ml-1 h-1 w-16 appearance-none rounded bg-border accent-accent"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(event) => setVolume(Number(event.target.value))}
          aria-label="音量"
        />
      </div>
    </div>
  );
}
