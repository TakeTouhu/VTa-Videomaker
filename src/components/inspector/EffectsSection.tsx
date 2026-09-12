import { useState } from "react";
import clsx from "clsx";
import type { Clip } from "@/types/timeline";
import type { EffectType } from "@/types/effects";
import { EFFECT_DEFINITIONS, effectDefinition } from "@/types/effects";
import { SliderField } from "@/components/ui/SliderField";
import { useEditorStore } from "@/store/editorStore";
import * as fx from "@/features/timeline/effectCommands";

interface EffectsSectionProps {
  clip: Clip;
}

/** Effect stack, applied in order after colour (design doc section 58). */
export function EffectsSection({ clip }: EffectsSectionProps) {
  const dispatch = useEditorStore((state) => state.dispatch);
  const [adding, setAdding] = useState(false);
  const effects = clip.effects ?? [];

  return (
    <section>
      <div className="mb-1 flex items-center justify-between border-b border-border pb-1">
        <h3 className="text-2xs uppercase tracking-wider text-text-secondary">Effects</h3>
        <button
          className="text-2xs text-text-muted underline hover:text-text"
          onClick={() => setAdding(!adding)}
        >
          追加
        </button>
      </div>

      {adding ? (
        <div className="mb-2 grid grid-cols-2 gap-1">
          {EFFECT_DEFINITIONS.map((definition) => (
            <button
              key={definition.type}
              className="rounded border border-border px-1 py-0.5 text-2xs hover:border-accent hover:text-text"
              onClick={() => {
                dispatch(fx.addEffectCommand(clip.id, definition.type as EffectType));
                setAdding(false);
              }}
            >
              {definition.label}
            </button>
          ))}
        </div>
      ) : null}

      {effects.length === 0 ? (
        <p className="py-2 text-2xs text-text-muted">エフェクトはありません</p>
      ) : null}

      {effects.map((effect, index) => {
        const definition = effectDefinition(effect.type);
        return (
          <div key={effect.id} className="mb-2 rounded border border-border p-1.5">
            <div className="flex items-center gap-1">
              <button
                className={clsx(
                  "h-4 w-4 rounded-sm border text-[9px]",
                  effect.enabled
                    ? "border-accent bg-accent-muted text-accent"
                    : "border-border text-text-muted",
                )}
                title="有効 / 無効"
                onClick={() =>
                  dispatch(
                    fx.updateEffectCommand(clip.id, effect.id, {
                      enabled: !effect.enabled,
                    }),
                  )
                }
              >
                ●
              </button>
              <span className="flex-1 text-2xs text-text">{definition?.label ?? effect.type}</span>
              <button
                className="text-2xs text-text-muted hover:text-text disabled:opacity-30"
                disabled={index === 0}
                onClick={() => dispatch(fx.reorderEffectCommand(clip.id, effect.id, -1))}
                title="上へ"
              >
                ▲
              </button>
              <button
                className="text-2xs text-text-muted hover:text-text disabled:opacity-30"
                disabled={index === effects.length - 1}
                onClick={() => dispatch(fx.reorderEffectCommand(clip.id, effect.id, 1))}
                title="下へ"
              >
                ▼
              </button>
              <button
                className="text-2xs text-text-muted hover:text-danger"
                onClick={() => dispatch(fx.removeEffectCommand(clip.id, effect.id))}
                title="削除"
              >
                ×
              </button>
            </div>

            {definition?.parameters.map((parameter) => (
              <SliderField
                key={parameter.key}
                label={parameter.label}
                value={Number(effect.parameters[parameter.key] ?? parameter.defaultValue)}
                min={parameter.min}
                max={parameter.max}
                step={parameter.step}
                defaultValue={parameter.defaultValue}
                onChange={(value) =>
                  dispatch(
                    fx.updateEffectCommand(clip.id, effect.id, {
                      parameters: { ...effect.parameters, [parameter.key]: value },
                    }),
                  )
                }
              />
            ))}

            {effect.type === "chromaKey" ? (
              <label className="flex items-center justify-between py-0.5">
                <span className="field-label">キー色</span>
                <input
                  type="color"
                  className="h-5 w-10 rounded border border-border bg-bg"
                  value={String(effect.parameters.color ?? "#00FF00")}
                  onChange={(event) =>
                    dispatch(
                      fx.updateEffectCommand(clip.id, effect.id, {
                        parameters: { ...effect.parameters, color: event.target.value },
                      }),
                    )
                  }
                />
              </label>
            ) : null}

            {effect.type === "lut" ? (
              <label className="flex items-center gap-1 py-0.5">
                <span className="field-label shrink-0">LUT</span>
                <input
                  className="num-input flex-1 text-left"
                  placeholder="film.cube"
                  value={String(effect.parameters.path ?? "")}
                  onChange={(event) =>
                    dispatch(
                      fx.updateEffectCommand(clip.id, effect.id, {
                        parameters: { ...effect.parameters, path: event.target.value },
                      }),
                    )
                  }
                />
              </label>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}
