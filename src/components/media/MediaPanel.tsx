import { useMemo, useState } from "react";
import clsx from "clsx";
import { Panel } from "@/components/ui/Panel";
import { MediaThumb } from "./MediaThumb";
import { MediaListRow } from "./MediaListRow";
import { useEditorStore } from "@/store/editorStore";
import { useUIStore } from "@/store/uiStore";
import { usePlaybackStore } from "@/store/playbackStore";
import { importDroppedFiles } from "@/services/mediaService";
import { MulticamDialog } from "./MulticamDialog";

interface MediaPanelProps {
  className?: string;
}

/** Project / Media panel (design doc section 8). */
export function MediaPanel({ className }: MediaPanelProps) {
  const media = useEditorStore((state) => state.project.media);
  const selectedMediaId = useEditorStore((state) => state.selectedMediaId);
  const selectMedia = useEditorStore((state) => state.selectMedia);
  const removeMedia = useEditorStore((state) => state.removeMedia);
  const showMedia = usePlaybackStore((state) => state.showMedia);

  const view = useUIStore((state) => state.mediaView);
  const setView = useUIStore((state) => state.setMediaView);
  const search = useUIStore((state) => state.mediaSearch);
  const setSearch = useUIStore((state) => state.setMediaSearch);

  const [dragOver, setDragOver] = useState(false);
  const [multicamOpen, setMulticamOpen] = useState(false);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return media;
    return media.filter((item) => item.name.toLowerCase().includes(query));
  }, [media, search]);

  const onSelect = (mediaId: string) => {
    selectMedia(mediaId);
    showMedia(mediaId);
  };

  return (
    <Panel
      title="Project / Media"
      className={className}
      actions={
        <>
          <button
            className={clsx("toolbar-button h-5 px-1.5", view === "grid" && "toolbar-button-active")}
            onClick={() => setView("grid")}
          >
            Grid
          </button>
          <button
            className={clsx("toolbar-button h-5 px-1.5", view === "list" && "toolbar-button-active")}
            onClick={() => setView("list")}
          >
            List
          </button>
          <button
            className="toolbar-button h-5 px-1.5"
            onClick={() => setMulticamOpen(true)}
            title="マルチカム同期"
          >
            Multicam
          </button>
        </>
      }
    >
      <div className="border-b border-border p-2">
        <input
          className="w-full rounded border border-border bg-bg px-2 py-1 text-xs outline-none focus:border-accent"
          placeholder="検索"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      <div
        className={clsx(
          "min-h-0 flex-1 overflow-auto p-2",
          dragOver && "bg-accent-muted/40 outline outline-1 outline-accent",
        )}
        onDragOver={(event) => {
          event.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragOver(false);
          void importDroppedFiles([...event.dataTransfer.files]);
        }}
      >
        {filtered.length === 0 ? (
          <p className="mt-8 text-center text-xs leading-relaxed text-text-muted">
            動画をここにドラッグ＆ドロップ
            <br />
            <span className="text-2xs">MP4 / MOV / WAV / PNG</span>
          </p>
        ) : view === "grid" ? (
          <div className="grid grid-cols-2 gap-2">
            {filtered.map((item) => (
              <MediaThumb
                key={item.id}
                item={item}
                selected={item.id === selectedMediaId}
                onSelect={onSelect}
                onRemove={removeMedia}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col">
            {filtered.map((item) => (
              <MediaListRow
                key={item.id}
                item={item}
                selected={item.id === selectedMediaId}
                onSelect={onSelect}
                onRemove={removeMedia}
              />
            ))}
          </div>
        )}
      </div>

      {multicamOpen ? <MulticamDialog onClose={() => setMulticamOpen(false)} /> : null}
    </Panel>
  );
}
