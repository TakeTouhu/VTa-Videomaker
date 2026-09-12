import { useMemo, useState } from "react";
import clsx from "clsx";
import { useAIStore } from "@/store/aiStore";
import { useEditorStore } from "@/store/editorStore";
import { segmentsOnTimeline } from "@/features/ai/transcriptPlans";
import { formatDuration } from "@/utils/time";

/** Transcript with timings (design doc section 20). Clicking a line seeks. */
export function TranscriptPanel() {
  const analyses = useAIStore((state) => state.analyses);
  const sequence = useEditorStore((state) => state.sequence());
  const setPlayhead = useEditorStore((state) => state.setPlayhead);
  const playhead = sequence.playhead;
  const [query, setQuery] = useState("");

  const segments = useMemo(
    () => segmentsOnTimeline(sequence, Object.values(analyses)),
    [sequence, analyses],
  );

  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase();
    if (!text) return segments;
    return segments.filter((segment) => segment.text.toLowerCase().includes(text));
  }, [segments, query]);

  if (segments.length === 0) {
    return (
      <p className="p-3 text-2xs leading-relaxed text-text-muted">
        文字起こしがありません。
        <br />
        AIアシスタントで「言い直しを削除」などを実行するか、解析を実行してください。
      </p>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-border p-2">
        <input
          className="w-full rounded border border-border bg-bg px-2 py-1 text-xs outline-none focus:border-accent"
          placeholder="文字起こしを検索"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-1">
        {filtered.map((segment, index) => {
          const active = playhead >= segment.start && playhead < segment.end;
          return (
            <button
              key={`${segment.clipId}-${index}`}
              className={clsx(
                "flex w-full gap-2 rounded px-1.5 py-1 text-left text-2xs",
                active ? "bg-accent-muted text-text" : "hover:bg-border/40",
              )}
              onClick={() => setPlayhead(segment.start)}
            >
              <span className="shrink-0 font-mono text-text-muted">
                {formatDuration(segment.start)}
              </span>
              <span className="flex-1 leading-relaxed text-text-secondary">
                {segment.text}
              </span>
            </button>
          );
        })}
        {filtered.length === 0 ? (
          <p className="p-2 text-2xs text-text-muted">一致する発言がありません</p>
        ) : null}
      </div>
    </div>
  );
}
