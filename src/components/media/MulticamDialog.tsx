import { useState } from "react";
import { useEditorStore } from "@/store/editorStore";
import { useUIStore } from "@/store/uiStore";
import { backend } from "@/services/backend";
import * as fx from "@/features/timeline/effectCommands";
import { appError } from "@/types/errors";
import { createId } from "@/utils/id";

interface MulticamDialogProps {
  onClose: () => void;
}

/** Multicam group creation with audio sync (design doc section 58). */
export function MulticamDialog({ onClose }: MulticamDialogProps) {
  const media = useEditorStore((state) => state.project.media);
  const dispatch = useEditorStore((state) => state.dispatch);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const videos = media.filter((item) => item.type === "video");

  const sync = async () => {
    if (selected.length < 2) return;
    setBusy(true);
    try {
      const offsets = await backend().syncMulticam(selected);
      const weak = offsets.filter((entry) => entry.confidence < 0.5);

      dispatch(
        fx.setMulticamGroupCommand({
          id: createId("mcam"),
          name: "マルチカム",
          syncMethod: "audio",
          angles: offsets.map((entry, index) => ({
            mediaId: entry.mediaId,
            name: media.find((item) => item.id === entry.mediaId)?.name ?? `アングル${index + 1}`,
            offset: entry.offset,
          })),
        }),
      );

      useUIStore
        .getState()
        .setStatus(
          weak.length > 0
            ? `同期しました（${weak.length}アングルは信頼度が低いため確認してください）`
            : "アングルを同期しました",
        );
      onClose();
    } catch (error) {
      useUIStore
        .getState()
        .pushError(appError("unknown", "アングルの同期に失敗しました", String(error)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-[420px] rounded border border-border bg-panel p-4 shadow-xl">
        <h2 className="mb-1 text-sm font-semibold">マルチカム同期</h2>
        <p className="mb-3 text-2xs leading-relaxed text-text-muted">
          同じ場面を撮影した素材を選ぶと、音声を照合してアングルを揃えます。
        </p>

        <div className="mb-3 max-h-56 overflow-auto rounded border border-border">
          {videos.length === 0 ? (
            <p className="p-3 text-2xs text-text-muted">動画素材がありません</p>
          ) : (
            videos.map((item) => (
              <label
                key={item.id}
                className="flex items-center gap-2 px-2 py-1 text-2xs hover:bg-border/30"
              >
                <input
                  type="checkbox"
                  className="accent-accent"
                  checked={selected.includes(item.id)}
                  onChange={(event) =>
                    setSelected((current) =>
                      event.target.checked
                        ? [...current, item.id]
                        : current.filter((id) => id !== item.id),
                    )
                  }
                />
                <span className="flex-1 truncate">{item.name}</span>
              </label>
            ))
          )}
        </div>

        <div className="flex justify-end gap-2">
          <button className="toolbar-button" onClick={onClose}>
            キャンセル
          </button>
          <button
            className="toolbar-button border-accent/60 bg-accent-muted text-accent disabled:opacity-40"
            disabled={selected.length < 2 || busy}
            onClick={() => void sync()}
          >
            {busy ? "同期中…" : "音声で同期"}
          </button>
        </div>
      </div>
    </div>
  );
}
