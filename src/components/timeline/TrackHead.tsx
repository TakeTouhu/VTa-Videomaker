import clsx from "clsx";
import type { Track } from "@/types/timeline";
import { useEditorStore } from "@/store/editorStore";
import { activeSequence, replaceSequence } from "@/features/project/factory";

interface TrackHeadProps {
  track: Track;
}

/** Track name plus lock / hide / mute / solo toggles (design doc section 12). */
export function TrackHead({ track }: TrackHeadProps) {
  const patchTrack = usePatchTrack();

  return (
    <div
      className="flex items-center gap-1 border-b border-border px-1.5"
      style={{ height: track.height }}
    >
      <span className="w-6 font-mono text-2xs text-text-secondary">{track.name}</span>
      <div className="flex flex-1 items-center justify-end gap-0.5">
        <Toggle
          label="L"
          title="トラックをロック"
          active={track.locked}
          onClick={() => patchTrack(track.id, { locked: !track.locked })}
        />
        {track.kind === "video" ? (
          <Toggle
            label="H"
            title="トラックを非表示"
            active={track.hidden}
            onClick={() => patchTrack(track.id, { hidden: !track.hidden })}
          />
        ) : (
          <>
            <Toggle
              label="M"
              title="ミュート"
              active={track.muted}
              onClick={() => patchTrack(track.id, { muted: !track.muted })}
            />
            <Toggle
              label="S"
              title="ソロ"
              active={track.solo}
              onClick={() => patchTrack(track.id, { solo: !track.solo })}
            />
          </>
        )}
      </div>
    </div>
  );
}

interface ToggleProps {
  label: string;
  title: string;
  active: boolean;
  onClick: () => void;
}

function Toggle({ label, title, active, onClick }: ToggleProps) {
  return (
    <button
      className={clsx(
        "h-4 w-4 rounded-sm border text-[9px] leading-none",
        active
          ? "border-accent bg-accent-muted text-accent"
          : "border-border text-text-muted hover:text-text",
      )}
      title={title}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

/** Track flags are view state, not an editing operation, so they skip history. */
function usePatchTrack() {
  return (trackId: string, patch: Partial<Track>) => {
    const state = useEditorStore.getState();
    const sequence = activeSequence(state.project);
    const apply = <T extends { id: string }>(tracks: T[]) =>
      tracks.map((track) => (track.id === trackId ? { ...track, ...patch } : track));

    useEditorStore.setState({
      project: replaceSequence(state.project, {
        ...sequence,
        videoTracks: apply(sequence.videoTracks),
        audioTracks: apply(sequence.audioTracks),
      }),
      dirty: true,
    });
  };
}
