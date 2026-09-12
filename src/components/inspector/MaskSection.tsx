import clsx from "clsx";
import type { Clip } from "@/types/timeline";
import type { MaskShape } from "@/types/effects";
import { DEFAULT_ELLIPSE, DEFAULT_RECTANGLE } from "@/types/effects";
import { SliderField } from "@/components/ui/SliderField";
import { useEditorStore } from "@/store/editorStore";
import * as fx from "@/features/timeline/effectCommands";
import { trackMask } from "@/services/trackingService";

interface MaskSectionProps {
  clip: Clip;
}

/** Masks and motion tracking (design doc section 17). */
export function MaskSection({ clip }: MaskSectionProps) {
  const dispatch = useEditorStore((state) => state.dispatch);
  const masks = clip.masks ?? [];

  const add = (shape: MaskShape) => dispatch(fx.addMaskCommand(clip.id, shape));

  return (
    <section className="mt-3">
      <div className="mb-1 flex items-center justify-between border-b border-border pb-1">
        <h3 className="text-2xs uppercase tracking-wider text-text-secondary">Masks</h3>
        <div className="flex gap-1">
          <button
            className="text-2xs text-text-muted underline hover:text-text"
            onClick={() => add(DEFAULT_RECTANGLE)}
          >
            矩形
          </button>
          <button
            className="text-2xs text-text-muted underline hover:text-text"
            onClick={() => add(DEFAULT_ELLIPSE)}
          >
            円
          </button>
        </div>
      </div>

      {masks.length === 0 ? (
        <p className="py-2 text-2xs leading-relaxed text-text-muted">
          マスクを追加すると、エフェクトと色調整がその範囲だけに適用されます。
        </p>
      ) : null}

      {masks.map((mask) => (
        <div key={mask.id} className="mb-2 rounded border border-border p-1.5">
          <div className="flex items-center gap-1">
            <button
              className={clsx(
                "h-4 w-4 rounded-sm border text-[9px]",
                mask.enabled
                  ? "border-accent bg-accent-muted text-accent"
                  : "border-border text-text-muted",
              )}
              onClick={() =>
                dispatch(
                  fx.updateMaskCommand(clip.id, mask.id, { enabled: !mask.enabled }),
                )
              }
              title="有効 / 無効"
            >
              ●
            </button>
            <span className="flex-1 text-2xs text-text">{mask.name}</span>
            <button
              className={clsx(
                "text-2xs hover:text-text",
                mask.inverted ? "text-accent" : "text-text-muted",
              )}
              onClick={() =>
                dispatch(
                  fx.updateMaskCommand(clip.id, mask.id, { inverted: !mask.inverted }),
                )
              }
              title="反転"
            >
              反転
            </button>
            <button
              className="text-2xs text-text-muted hover:text-danger"
              onClick={() => dispatch(fx.removeMaskCommand(clip.id, mask.id))}
              title="削除"
            >
              ×
            </button>
          </div>

          <SliderField
            label="ぼかし"
            value={mask.feather}
            min={0}
            max={0.3}
            step={0.005}
            defaultValue={0.03}
            onChange={(feather) =>
              dispatch(fx.updateMaskCommand(clip.id, mask.id, { feather }))
            }
          />
          <SliderField
            label="拡張"
            value={mask.expansion}
            min={-0.2}
            max={0.2}
            step={0.005}
            defaultValue={0}
            onChange={(expansion) =>
              dispatch(fx.updateMaskCommand(clip.id, mask.id, { expansion }))
            }
          />
          <SliderField
            label="不透明度"
            value={mask.opacity}
            min={0}
            max={1}
            step={0.01}
            defaultValue={1}
            onChange={(opacity) =>
              dispatch(fx.updateMaskCommand(clip.id, mask.id, { opacity }))
            }
          />

          <div className="mt-1 flex items-center gap-1">
            <button
              className="toolbar-button h-5 flex-1 justify-center text-2xs"
              onClick={() => void trackMask(clip.id, mask.id)}
              title="マスクを対象物に追従させる"
            >
              トラッキング
            </button>
            {mask.track.length > 0 ? (
              <span className="text-2xs text-text-muted">{mask.track.length}点</span>
            ) : null}
          </div>
        </div>
      ))}
    </section>
  );
}
