import clsx from "clsx";
import { useEditorStore } from "@/store/editorStore";
import { useUIStore } from "@/store/uiStore";
import * as commands from "@/features/timeline/commands";

/** Tools and timeline-level actions (design doc sections 12-13). */
export function TimelineToolbar() {
  const tool = useEditorStore((state) => state.tool);
  const setTool = useEditorStore((state) => state.setTool);
  const snapEnabled = useEditorStore((state) => state.snapEnabled);
  const toggleSnap = useEditorStore((state) => state.toggleSnap);
  const selectedClipIds = useEditorStore((state) => state.selectedClipIds);
  const dispatch = useEditorStore((state) => state.dispatch);
  const clearSelection = useEditorStore((state) => state.clearSelection);
  const sequence = useEditorStore((state) => state.sequence());
  const zoomIn = useUIStore((state) => state.zoomIn);
  const zoomOut = useUIStore((state) => state.zoomOut);

  const hasSelection = selectedClipIds.length > 0;

  return (
    <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border bg-panel px-2">
      <button
        className={clsx("toolbar-button", tool === "selection" && "toolbar-button-active")}
        onClick={() => setTool("selection")}
        title="選択ツール (V)"
      >
        Selection
      </button>
      <button
        className={clsx("toolbar-button", tool === "razor" && "toolbar-button-active")}
        onClick={() => setTool("razor")}
        title="レーザーツール (C)"
      >
        Razor
      </button>

      <div className="mx-1 h-4 w-px bg-border" />

      <button
        className="toolbar-button"
        onClick={() => dispatch(commands.splitAtPlayheadCommand(sequence.playhead))}
        title="再生ヘッドで分割"
      >
        Split
      </button>
      <button
        className="toolbar-button disabled:opacity-40"
        disabled={!hasSelection}
        onClick={() => {
          dispatch(commands.deleteClipsCommand(selectedClipIds));
          clearSelection();
        }}
        title="削除 (Delete)"
      >
        Delete
      </button>
      <button
        className="toolbar-button disabled:opacity-40"
        disabled={!hasSelection}
        onClick={() => {
          dispatch(commands.rippleDeleteCommand(selectedClipIds));
          clearSelection();
        }}
        title="リップル削除 (Shift+Delete)"
      >
        Ripple Delete
      </button>

      <button
        className="toolbar-button"
        onClick={() => {
          // Lands on the topmost video track, covering the next 5 seconds.
          const track = sequence.videoTracks[sequence.videoTracks.length - 1];
          if (!track) return;
          dispatch(
            commands.addAdjustmentLayerCommand(track.id, sequence.playhead, 5),
          );
        }}
        title="調整レイヤーを追加（下のレイヤーに色調整を適用）"
      >
        Adjustment
      </button>

      <div className="mx-1 h-4 w-px bg-border" />

      <button
        className={clsx("toolbar-button", snapEnabled && "toolbar-button-active")}
        onClick={toggleSnap}
        title="スナップ (S)"
      >
        Snap
      </button>

      <div className="flex-1" />

      <button className="toolbar-button" onClick={zoomOut} title="ズームアウト (-)">
        −
      </button>
      <button className="toolbar-button" onClick={zoomIn} title="ズームイン (+)">
        ＋
      </button>
    </div>
  );
}
