import clsx from "clsx";
import { Panel } from "@/components/ui/Panel";
import { TransformSection } from "./TransformSection";
import { EffectsSection } from "./EffectsSection";
import { MaskSection } from "./MaskSection";
import { TextSection } from "./TextSection";
import { ColorSection } from "./ColorSection";
import { AudioSection } from "./AudioSection";
import { useEditorStore } from "@/store/editorStore";
import { useUIStore } from "@/store/uiStore";
import type { InspectorTab } from "@/store/uiStore";

interface InspectorPanelProps {
  className?: string;
}

const TABS: { id: InspectorTab; label: string }[] = [
  { id: "effect", label: "Effect" },
  { id: "color", label: "Color" },
  { id: "audio", label: "Audio" },
];

/** Inspector for the selected clip (design doc sections 14-15). */
export function InspectorPanel({ className }: InspectorPanelProps) {
  const selected = useEditorStore((state) => state.selectedClips());
  const tab = useUIStore((state) => state.inspectorTab);
  const setTab = useUIStore((state) => state.setInspectorTab);
  const clip = selected[0];

  return (
    <Panel title="Inspector" className={className}>
      <div className="flex shrink-0 border-b border-border">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            className={clsx(
              "flex-1 border-b-2 px-2 py-1.5 text-2xs uppercase tracking-wide",
              tab === entry.id
                ? "border-accent text-accent"
                : "border-transparent text-text-secondary hover:text-text",
            )}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-2">
        {!clip ? (
          <p className="mt-6 text-center text-xs text-text-muted">
            クリップを選択してください
          </p>
        ) : selected.length > 1 ? (
          <p className="mt-6 text-center text-xs text-text-muted">
            {selected.length}個のクリップを選択中
            <br />
            <span className="text-2xs">単一選択で編集できます</span>
          </p>
        ) : tab === "effect" ? (
          <div className="flex flex-col gap-3">
            {clip.kind === "text" ? <TextSection clip={clip} /> : null}
            <TransformSection clip={clip} />
            <EffectsSection clip={clip} />
            <MaskSection clip={clip} />
          </div>
        ) : tab === "color" ? (
          <ColorSection clip={clip} />
        ) : (
          <AudioSection clip={clip} />
        )}
      </div>
    </Panel>
  );
}
