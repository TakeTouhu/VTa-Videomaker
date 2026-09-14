/** Project save / load / autosave orchestration (design doc sections 33, 48). */

import { backend } from "./backend";
import { useEditorStore } from "@/store/editorStore";
import { useUIStore } from "@/store/uiStore";
import { appError, userMessage } from "@/types/errors";
import { migrateProject } from "@/features/project/migrate";

export async function saveProject(): Promise<void> {
  const state = useEditorStore.getState();
  const ui = useUIStore.getState();
  try {
    const path = await backend().saveProject(state.project, state.savedPath ?? undefined);
    useEditorStore.getState().markSaved(path);
    ui.setStatus("保存しました");
  } catch (error) {
    ui.pushError(
      appError("unknown", "プロジェクトを保存できませんでした", String(error)),
    );
  }
}

/** Same as saveProject but silent: it must never interrupt editing. */
export async function autosaveProject(): Promise<void> {
  const state = useEditorStore.getState();
  try {
    const path = await backend().saveProject(state.project, state.savedPath ?? undefined);
    useEditorStore.getState().markSaved(path);
  } catch {
    // Autosave failures are logged by the Rust core; the next manual save
    // surfaces the problem to the user.
  }
}

export async function openProject(path: string): Promise<void> {
  const ui = useUIStore.getState();
  try {
    const raw = await backend().loadProject(path);
    useEditorStore.getState().setProject(migrateProject(raw), path);
    ui.setStatus(`${raw.name} を開きました`);
  } catch (error) {
    ui.pushError(
      appError("project_load_failed", userMessage("project_load_failed"), String(error)),
    );
  }
}
