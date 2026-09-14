/** Global shortcuts (design doc section 40). */

import { useEffect } from "react";
import { useEditorStore } from "@/store/editorStore";
import { usePlaybackStore } from "@/store/playbackStore";
import { useUIStore } from "@/store/uiStore";
import * as commands from "@/features/timeline/commands";
import { saveProject } from "@/services/projectService";

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.isContentEditable
  );
}

export function useKeyboardShortcuts(): void {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (isTypingTarget(event.target)) return;

      const editor = useEditorStore.getState();
      const ui = useUIStore.getState();
      const playback = usePlaybackStore.getState();
      const mod = event.ctrlKey || event.metaKey;

      if (mod && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) editor.redo();
        else editor.undo();
        return;
      }
      if (mod && event.key.toLowerCase() === "y") {
        event.preventDefault();
        editor.redo();
        return;
      }
      if (mod && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveProject();
        return;
      }
      if (mod && event.key.toLowerCase() === "c") {
        event.preventDefault();
        editor.copySelection();
        return;
      }
      if (mod && event.key.toLowerCase() === "x") {
        event.preventDefault();
        editor.cutSelection();
        return;
      }
      if (mod && event.key.toLowerCase() === "v") {
        event.preventDefault();
        editor.pasteClipboard(editor.sequence().playhead);
        return;
      }
      if (mod && event.key.toLowerCase() === "d") {
        event.preventDefault();
        if (editor.selectedClipIds.length > 0) {
          editor.dispatch(commands.duplicateClipsCommand(editor.selectedClipIds));
        }
        return;
      }

      switch (event.key) {
        case " ":
          event.preventDefault();
          playback.toggle();
          break;
        case "v":
        case "V":
          editor.setTool("selection");
          break;
        case "c":
        case "C":
          editor.setTool("razor");
          break;
        case "s":
        case "S":
          editor.toggleSnap();
          break;
        case "Delete":
        case "Backspace": {
          if (editor.selectedClipIds.length === 0) break;
          event.preventDefault();
          editor.dispatch(
            event.shiftKey
              ? commands.rippleDeleteCommand(editor.selectedClipIds)
              : commands.deleteClipsCommand(editor.selectedClipIds),
          );
          editor.clearSelection();
          break;
        }
        case "+":
        case "=":
          ui.zoomIn();
          break;
        case "-":
        case "_":
          ui.zoomOut();
          break;
        case "ArrowLeft":
        case "ArrowRight": {
          event.preventDefault();
          const sequence = editor.sequence();
          const step = event.shiftKey ? 1 : 1 / sequence.fps;
          const direction = event.key === "ArrowLeft" ? -1 : 1;
          editor.setPlayhead(sequence.playhead + step * direction);
          break;
        }
        case "Home":
          editor.setPlayhead(0);
          break;
        default:
          break;
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
