import type { Clip } from "@/types/timeline";
import { DEFAULT_TEXT } from "@/types/effects";
import { SliderField } from "@/components/ui/SliderField";
import { useEditorStore } from "@/store/editorStore";
import * as fx from "@/features/timeline/effectCommands";

interface TextSectionProps {
  clip: Clip;
}

/** Text clip settings (design doc section 58). */
export function TextSection({ clip }: TextSectionProps) {
  const dispatch = useEditorStore((state) => state.dispatch);
  const text = { ...DEFAULT_TEXT, ...clip.text };

  const patch = (value: Partial<typeof text>) =>
    dispatch(fx.updateTextCommand(clip.id, value));

  return (
    <section>
      <h3 className="mb-1 border-b border-border pb-1 text-2xs uppercase tracking-wider text-text-secondary">
        Text
      </h3>

      <textarea
        className="mb-2 w-full resize-none rounded border border-border bg-bg px-2 py-1 text-xs outline-none focus:border-accent"
        rows={3}
        value={text.content}
        onChange={(event) => patch({ content: event.target.value })}
      />

      <label className="flex items-center justify-between py-0.5">
        <span className="field-label">フォント</span>
        <input
          className="num-input w-36 text-left"
          value={text.fontFamily}
          onChange={(event) => patch({ fontFamily: event.target.value })}
        />
      </label>

      <SliderField
        label="サイズ"
        value={text.fontSize}
        min={8}
        max={200}
        defaultValue={DEFAULT_TEXT.fontSize}
        onChange={(fontSize) => patch({ fontSize })}
      />

      <label className="flex items-center justify-between py-0.5">
        <span className="field-label">色</span>
        <input
          type="color"
          className="h-5 w-10 rounded border border-border bg-bg"
          value={text.color}
          onChange={(event) => patch({ color: event.target.value })}
        />
      </label>

      <label className="flex items-center justify-between py-0.5">
        <span className="field-label">縁取り</span>
        <input
          type="color"
          className="h-5 w-10 rounded border border-border bg-bg"
          value={text.outlineColor}
          onChange={(event) => patch({ outlineColor: event.target.value })}
        />
      </label>

      <SliderField
        label="縁の太さ"
        value={text.outlineWidth}
        min={0}
        max={12}
        defaultValue={DEFAULT_TEXT.outlineWidth}
        onChange={(outlineWidth) => patch({ outlineWidth })}
      />

      <SliderField
        label="位置 X"
        value={text.x}
        min={0}
        max={1}
        step={0.01}
        defaultValue={0.5}
        onChange={(x) => patch({ x })}
      />
      <SliderField
        label="位置 Y"
        value={text.y}
        min={0}
        max={1}
        step={0.01}
        defaultValue={0.5}
        onChange={(y) => patch({ y })}
      />

      <label className="flex items-center justify-between py-0.5">
        <span className="field-label">揃え</span>
        <select
          className="rounded border border-border bg-bg px-1 py-0.5 text-2xs outline-none"
          value={text.alignment}
          onChange={(event) =>
            patch({ alignment: event.target.value as typeof text.alignment })
          }
        >
          <option value="left">左</option>
          <option value="center">中央</option>
          <option value="right">右</option>
        </select>
      </label>
    </section>
  );
}
