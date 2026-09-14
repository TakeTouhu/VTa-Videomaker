import { useState } from "react";
import clsx from "clsx";
import { useEditorStore } from "@/store/editorStore";
import * as commands from "@/features/timeline/commands";
import { captionsToSrt } from "@/features/ai/captions";
import { formatDuration } from "@/utils/time";
import { useUIStore } from "@/store/uiStore";

/** Caption editor (design doc section 58): retime, rewrite and restyle cues. */
export function CaptionEditor() {
  const sequence = useEditorStore((state) => state.sequence());
  const dispatch = useEditorStore((state) => state.dispatch);
  const setPlayhead = useEditorStore((state) => state.setPlayhead);
  const [showStyle, setShowStyle] = useState(false);

  const track = sequence.captionTracks?.[0];

  if (!track) {
    return (
      <p className="p-3 text-2xs leading-relaxed text-text-muted">
        字幕がありません。
        <br />
        AIアシスタントで「字幕を作って」と指示すると、文字起こしから生成します。
      </p>
    );
  }

  const style = track.style;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 border-b border-border p-1.5">
        <button
          className={clsx("toolbar-button h-6", track.enabled && "toolbar-button-active")}
          onClick={() => dispatch(commands.toggleCaptionTrackCommand(track.id))}
          title="字幕の表示"
        >
          {track.enabled ? "表示中" : "非表示"}
        </button>
        <button
          className="toolbar-button h-6"
          onClick={() => setShowStyle(!showStyle)}
        >
          スタイル
        </button>
        <div className="flex-1" />
        <button
          className="toolbar-button h-6"
          title="SRTをクリップボードにコピー"
          onClick={() => {
            void navigator.clipboard
              .writeText(captionsToSrt(track.cues))
              .then(() => useUIStore.getState().setStatus("SRTをコピーしました"));
          }}
        >
          SRT
        </button>
      </div>

      {showStyle ? (
        <div className="space-y-1 border-b border-border p-2">
          <label className="flex items-center justify-between gap-2">
            <span className="field-label">文字サイズ</span>
            <input
              type="number"
              className="num-input w-16"
              value={style.fontSize}
              onChange={(event) =>
                dispatch(
                  commands.setCaptionStyleCommand(track.id, {
                    fontSize: Number(event.target.value),
                  }),
                )
              }
            />
          </label>
          <label className="flex items-center justify-between gap-2">
            <span className="field-label">位置（下からの高さ）</span>
            <input
              type="range"
              className="h-1 w-28 appearance-none rounded bg-border accent-accent"
              min={0.5}
              max={0.95}
              step={0.01}
              value={style.positionY}
              onChange={(event) =>
                dispatch(
                  commands.setCaptionStyleCommand(track.id, {
                    positionY: Number(event.target.value),
                  }),
                )
              }
            />
          </label>
          <label className="flex items-center justify-between gap-2">
            <span className="field-label">背景</span>
            <input
              type="checkbox"
              className="accent-accent"
              checked={style.backgroundColor !== ""}
              onChange={(event) =>
                dispatch(
                  commands.setCaptionStyleCommand(track.id, {
                    backgroundColor: event.target.checked ? "#000000A0" : "",
                  }),
                )
              }
            />
          </label>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto p-1">
        {track.cues.map((cue) => {
          const active = sequence.playhead >= cue.start && sequence.playhead < cue.end;
          return (
            <div
              key={cue.id}
              className={clsx(
                "mb-1 rounded border p-1.5",
                active ? "border-accent bg-accent-muted/30" : "border-border",
              )}
            >
              <div className="flex items-center gap-2 text-2xs text-text-muted">
                <button
                  className="font-mono hover:text-text"
                  onClick={() => setPlayhead(cue.start)}
                  title="この位置へ移動"
                >
                  {formatDuration(cue.start)} – {formatDuration(cue.end)}
                </button>
                <div className="flex-1" />
                <button
                  className="hover:text-danger"
                  onClick={() =>
                    dispatch(commands.deleteCaptionCueCommand(track.id, cue.id))
                  }
                  title="削除"
                >
                  ×
                </button>
              </div>
              <textarea
                className="mt-1 w-full resize-none rounded border border-transparent bg-transparent text-xs leading-relaxed text-text outline-none focus:border-accent"
                rows={Math.max(1, cue.text.split("\n").length)}
                value={cue.text}
                onChange={(event) =>
                  dispatch(
                    commands.updateCaptionCueCommand(track.id, cue.id, {
                      text: event.target.value,
                    }),
                  )
                }
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
