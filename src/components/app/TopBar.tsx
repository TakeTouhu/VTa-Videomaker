import clsx from "clsx";
import { useEditorStore } from "@/store/editorStore";
import { useUIStore } from "@/store/uiStore";
import { canRedo, canUndo, redoLabel, undoLabel } from "@/features/history/historyManager";
import { saveProject } from "@/services/projectService";

/** Menu / project name / undo / redo / export (design doc section 7). */
export function TopBar() {
  const name = useEditorStore((state) => state.project.name);
  const dirty = useEditorStore((state) => state.dirty);
  const history = useEditorStore((state) => state.history);
  const undo = useEditorStore((state) => state.undo);
  const redo = useEditorStore((state) => state.redo);
  const newProject = useEditorStore((state) => state.newProject);
  const renameProject = useEditorStore((state) => state.renameProject);
  const setExportDialogOpen = useUIStore((state) => state.setExportDialogOpen);
  const toggleAIPanel = useUIStore((state) => state.toggleAIPanel);
  const aiPanelOpen = useUIStore((state) => state.aiPanelOpen);

  return (
    <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-panel px-3">
      <div className="flex items-center gap-1.5 pr-2">
        <span className="h-3 w-3 rounded-sm bg-accent" aria-hidden />
        <span className="text-xs font-semibold tracking-wide">AI Video Editor</span>
      </div>

      <button className="toolbar-button" onClick={() => newProject()}>
        New
      </button>
      <button className="toolbar-button" onClick={() => void saveProject()}>
        Save
      </button>

      <div className="mx-2 h-5 w-px bg-border" />

      <button
        className="toolbar-button disabled:opacity-40"
        disabled={!canUndo(history)}
        title={undoLabel(history) ? `元に戻す: ${undoLabel(history)}` : "元に戻す"}
        onClick={undo}
      >
        Undo
      </button>
      <button
        className="toolbar-button disabled:opacity-40"
        disabled={!canRedo(history)}
        title={redoLabel(history) ? `やり直す: ${redoLabel(history)}` : "やり直す"}
        onClick={redo}
      >
        Redo
      </button>

      <div className="flex flex-1 justify-center">
        <input
          className="w-64 rounded border border-transparent bg-transparent px-2 py-1 text-center text-xs text-text-secondary outline-none hover:border-border focus:border-accent focus:text-text"
          value={name}
          onChange={(event) => renameProject(event.target.value)}
          aria-label="プロジェクト名"
        />
        {dirty ? <span className="self-center text-2xs text-warning">●</span> : null}
      </div>

      <button
        className={clsx("toolbar-button", aiPanelOpen && "toolbar-button-active")}
        onClick={toggleAIPanel}
      >
        AI
      </button>
      <button
        className="toolbar-button border-accent/60 bg-accent-muted text-accent"
        onClick={() => setExportDialogOpen(true)}
      >
        Export
      </button>
    </header>
  );
}
