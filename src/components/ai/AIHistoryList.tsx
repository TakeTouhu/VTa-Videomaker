import { useAIStore } from "@/store/aiStore";
import { useEditorStore } from "@/store/editorStore";

/** Applied AI edits, each undoable (design doc section 62). */
export function AIHistoryList() {
  const entries = useAIStore((state) => state.entries);
  const undo = useEditorStore((state) => state.undo);
  const undoStack = useEditorStore((state) => state.history.undoStack);

  if (entries.length === 0) return null;

  const topLabel = undoStack[undoStack.length - 1]?.command.label;

  return (
    <div className="mt-3 border-t border-border pt-2">
      <h3 className="mb-1 text-2xs uppercase tracking-wider text-text-secondary">
        AI History
      </h3>
      {[...entries].reverse().map((entry) => (
        <div key={entry.id} className="flex items-center justify-between gap-2 py-0.5">
          <span className="truncate text-2xs text-text-secondary">
            <span className="font-mono text-text-muted">
              {new Date(entry.appliedAt).toLocaleTimeString("ja-JP", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>{" "}
            {entry.summary}
          </span>
          {entry.commandLabel === topLabel ? (
            <button
              className="shrink-0 text-2xs text-text-muted underline hover:text-text"
              onClick={undo}
              title="この編集を取り消す"
            >
              Undo
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
