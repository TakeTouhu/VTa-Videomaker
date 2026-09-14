import type { Clip } from "@/types/timeline";
import { NumberField } from "@/components/ui/NumberField";
import { SliderField } from "@/components/ui/SliderField";
import { useEditorStore } from "@/store/editorStore";
import * as commands from "@/features/timeline/commands";
import { clipDuration } from "@/features/timeline/engine";
import { formatDuration } from "@/utils/time";
import { KeyframeButton } from "./KeyframeButton";

interface TransformSectionProps {
  clip: Clip;
}

/** Transform + speed (design doc section 14). */
export function TransformSection({ clip }: TransformSectionProps) {
  const dispatch = useEditorStore((state) => state.dispatch);

  const patchTransform = (patch: Parameters<typeof commands.changeTransformCommand>[1]) =>
    dispatch(commands.changeTransformCommand(clip.id, patch));

  return (
    <div className="flex flex-col gap-3">
      <Group title="Transform">
        <NumberField
          label="Position X"
          value={clip.transform.positionX}
          onChange={(positionX) => patchTransform({ positionX })}
        />
        <NumberField
          label="Position Y"
          value={clip.transform.positionY}
          onChange={(positionY) => patchTransform({ positionY })}
        />
        <div className="flex items-end gap-1">
          <div className="flex-1">
            <SliderField
              label="Scale"
              value={clip.transform.scale}
              min={1}
              max={400}
              defaultValue={100}
              onChange={(scale) => patchTransform({ scale })}
            />
          </div>
          <KeyframeButton
            clip={clip}
            property="transform.scale"
            value={clip.transform.scale}
          />
        </div>
        <div className="flex items-end gap-1">
          <div className="flex-1">
            <SliderField
              label="Rotation"
              value={clip.transform.rotation}
              min={-180}
              max={180}
              defaultValue={0}
              onChange={(rotation) => patchTransform({ rotation })}
            />
          </div>
          <KeyframeButton
            clip={clip}
            property="transform.rotation"
            value={clip.transform.rotation}
          />
        </div>
        <div className="flex items-end gap-1">
          <div className="flex-1">
            <SliderField
              label="Opacity"
              value={clip.transform.opacity}
              min={0}
              max={100}
              defaultValue={100}
              onChange={(opacity) => patchTransform({ opacity })}
            />
          </div>
          <KeyframeButton
            clip={clip}
            property="transform.opacity"
            value={clip.transform.opacity}
          />
        </div>
      </Group>

      <Group title="Video">
        <SliderField
          label="Speed"
          value={clip.speed}
          min={0.1}
          max={4}
          step={0.05}
          defaultValue={1}
          onChange={(speed) => dispatch(commands.changeSpeedCommand(clip.id, speed))}
        />
        <div className="flex items-center justify-between py-0.5">
          <span className="field-label">Duration</span>
          <span className="font-mono text-2xs text-text-secondary">
            {formatDuration(clipDuration(clip))}
          </span>
        </div>
        <div className="flex items-center justify-between py-0.5">
          <span className="field-label">Source In / Out</span>
          <span className="font-mono text-2xs text-text-secondary">
            {formatDuration(clip.sourceIn)} – {formatDuration(clip.sourceOut)}
          </span>
        </div>
      </Group>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-1 border-b border-border pb-1 text-2xs uppercase tracking-wider text-text-secondary">
        {title}
      </h3>
      {children}
    </section>
  );
}
