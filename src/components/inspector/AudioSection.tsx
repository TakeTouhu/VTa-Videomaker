import type { Clip } from "@/types/timeline";
import { DEFAULT_AUDIO } from "@/types/timeline";
import { SliderField } from "@/components/ui/SliderField";
import { NumberField } from "@/components/ui/NumberField";
import { useEditorStore } from "@/store/editorStore";
import * as commands from "@/features/timeline/commands";

interface AudioSectionProps {
  clip: Clip;
}

/** Volume / pan / fades (design doc section 14). */
export function AudioSection({ clip }: AudioSectionProps) {
  const dispatch = useEditorStore((state) => state.dispatch);
  const audio = clip.audio ?? DEFAULT_AUDIO;

  const patch = (value: Partial<typeof audio>) =>
    dispatch(commands.changeAudioCommand(clip.id, value));

  if (!clip.audio) {
    return (
      <p className="mt-6 text-center text-xs text-text-muted">
        このクリップには音声がありません
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <SliderField
        label="Volume (dB)"
        value={audio.volume}
        min={-60}
        max={12}
        step={0.5}
        defaultValue={0}
        onChange={(volume) => patch({ volume })}
      />
      <SliderField
        label="Pan"
        value={audio.pan}
        min={-100}
        max={100}
        defaultValue={0}
        onChange={(pan) => patch({ pan })}
      />
      <NumberField
        label="Fade In"
        value={audio.fadeIn}
        min={0}
        step={0.1}
        unit="s"
        onChange={(fadeIn) => patch({ fadeIn })}
      />
      <NumberField
        label="Fade Out"
        value={audio.fadeOut}
        min={0}
        step={0.1}
        unit="s"
        onChange={(fadeOut) => patch({ fadeOut })}
      />
      <label className="mt-1 flex items-center gap-2 text-2xs text-text-secondary">
        <input
          type="checkbox"
          className="accent-accent"
          checked={audio.muted}
          onChange={(event) => patch({ muted: event.target.checked })}
        />
        ミュート
      </label>
    </div>
  );
}
