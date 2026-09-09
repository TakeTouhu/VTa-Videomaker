/** Autosave (design doc section 33): saves at most once per interval, and only
 *  when something actually changed. */

import { useEffect, useRef } from "react";
import { useEditorStore } from "@/store/editorStore";
import { autosaveProject } from "@/services/projectService";

export function useAutosave(): void {
  const savingRef = useRef(false);

  useEffect(() => {
    const interval = window.setInterval(() => {
      const state = useEditorStore.getState();
      if (!state.dirty || savingRef.current) return;
      savingRef.current = true;
      void autosaveProject().finally(() => {
        savingRef.current = false;
      });
    }, useEditorStore.getState().project.settings.autosaveIntervalMs);

    return () => window.clearInterval(interval);
  }, []);
}
