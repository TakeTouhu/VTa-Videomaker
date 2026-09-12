import { useState } from "react";
import type { Clip } from "@/types/timeline";
import type { ColorSettings, CurveChannel, CurvePoint } from "@/types/color";
import {
  BASIC_COLOR_KEYS,
  COLOR_RANGES,
  DEFAULT_COLOR,
  LINEAR_CURVE,
  hasCurveAdjustment,
} from "@/types/color";
import { SliderField } from "@/components/ui/SliderField";
import { CurveChannelTabs, CurveEditor } from "./CurveEditor";
import { useEditorStore } from "@/store/editorStore";
import * as commands from "@/features/timeline/commands";

interface ColorSectionProps {
  clip: Clip;
}

type BasicKey = (typeof BASIC_COLOR_KEYS)[number];

const LABELS: Record<BasicKey, string> = {
  exposure: "Exposure",
  contrast: "Contrast",
  highlights: "Highlights",
  shadows: "Shadows",
  whites: "Whites",
  blacks: "Blacks",
  temperature: "Temperature",
  tint: "Tint",
  saturation: "Saturation",
};

const BASIC_ORDER: BasicKey[] = [
  "exposure",
  "contrast",
  "highlights",
  "shadows",
  "whites",
  "blacks",
  "temperature",
  "tint",
  "saturation",
];

/** Basic grading plus tone curves (design doc sections 15.1 and 15.2). */
export function ColorSection({ clip }: ColorSectionProps) {
  const dispatch = useEditorStore((state) => state.dispatch);
  const [channel, setChannel] = useState<CurveChannel>("rgb");
  const [showCurves, setShowCurves] = useState(false);

  const patch = (value: Partial<ColorSettings>) =>
    dispatch(commands.changeColorCommand(clip.id, value));

  const setCurve = (points: CurvePoint[]) =>
    patch({ curves: { ...clip.color.curves, [channel]: points } });

  const points = clip.color.curves?.[channel] ?? LINEAR_CURVE;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between border-b border-border pb-1">
        <h3 className="text-2xs uppercase tracking-wider text-text-secondary">Basic</h3>
        <button
          className="text-2xs text-text-muted underline hover:text-text"
          onClick={() => patch({ ...DEFAULT_COLOR, curves: undefined })}
        >
          リセット
        </button>
      </div>

      {BASIC_ORDER.map((key) => {
        const range = COLOR_RANGES[key];
        return (
          <SliderField
            key={key}
            label={LABELS[key]}
            value={clip.color[key]}
            min={range[0]}
            max={range[1]}
            defaultValue={DEFAULT_COLOR[key]}
            onChange={(value) => patch({ [key]: value })}
          />
        );
      })}

      <div className="mt-3 flex items-center justify-between border-b border-border pb-1">
        <button
          className="text-2xs uppercase tracking-wider text-text-secondary hover:text-text"
          onClick={() => setShowCurves(!showCurves)}
        >
          {showCurves ? "▾" : "▸"} Curves
          {hasCurveAdjustment(clip.color.curves) ? (
            <span className="ml-1 text-accent">●</span>
          ) : null}
        </button>
        {showCurves ? (
          <button
            className="text-2xs text-text-muted underline hover:text-text"
            onClick={() => patch({ curves: undefined })}
          >
            カーブをリセット
          </button>
        ) : null}
      </div>

      {showCurves ? (
        <div className="mt-1 space-y-1">
          <CurveChannelTabs active={channel} onSelect={setChannel} />
          <CurveEditor channel={channel} points={points} onChange={setCurve} />
          <p className="text-2xs leading-relaxed text-text-muted">
            クリックで点を追加、ドラッグで移動、右クリックまたはダブルクリックで削除。
          </p>
        </div>
      ) : null}

      <p className="mt-2 text-2xs leading-relaxed text-text-muted">
        プレビューは近似表示です。最終的な色は書き出し時にFFmpegで適用されます。
      </p>
    </div>
  );
}
