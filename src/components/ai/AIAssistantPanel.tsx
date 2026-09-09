import { useState } from "react";
import clsx from "clsx";
import { Panel } from "@/components/ui/Panel";
import { EditPlanCard } from "./EditPlanCard";
import { AIHistoryList } from "./AIHistoryList";
import { useAIStore } from "@/store/aiStore";
import type { AIEditMode } from "@/store/aiStore";
import { proposeSilenceCut } from "@/services/aiService";

interface AIAssistantPanelProps {
  className?: string;
}

const MODES: { id: AIEditMode; label: string; hint: string }[] = [
  { id: "auto", label: "Auto", hint: "AIが完全自動で編集します" },
  { id: "assistant", label: "Assistant", hint: "AIが編集案を作り、確認してから適用します" },
  { id: "manual", label: "Manual", hint: "通常の手動編集のみ" },
];

/**
 * AI Assistant panel (design doc sections 18-24).
 *
 * Phase 3 wires a real provider behind aiService; until then the panel offers
 * the built-in, deterministic AI Silence Cut and states plainly what is not
 * available yet rather than pretending to understand free-form requests.
 */
export function AIAssistantPanel({ className }: AIAssistantPanelProps) {
  const messages = useAIStore((state) => state.messages);
  const busy = useAIStore((state) => state.busy);
  const mode = useAIStore((state) => state.mode);
  const setMode = useAIStore((state) => state.setMode);
  const addMessage = useAIStore((state) => state.addMessage);
  const pendingPlan = useAIStore((state) => state.pendingPlan);
  const [input, setInput] = useState("");

  const send = () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    addMessage("user", text);

    // Only the built-in silence cut is implemented; anything else says so.
    if (/無音|silence/i.test(text)) {
      void proposeSilenceCut();
      return;
    }
    addMessage(
      "assistant",
      "現在は「無音部分を削除して」に対応しています。自然言語での編集指示はPhase 3で有効になります。",
    );
  };

  return (
    <Panel
      title="AI Assistant"
      className={className}
      actions={
        <select
          className="rounded border border-border bg-bg px-1 py-0.5 text-2xs outline-none"
          value={mode}
          onChange={(event) => setMode(event.target.value as AIEditMode)}
          title={MODES.find((entry) => entry.id === mode)?.hint}
        >
          {MODES.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.label}
            </option>
          ))}
        </select>
      }
    >
      <div className="min-h-0 flex-1 space-y-2 overflow-auto p-2">
        {messages.length === 0 ? (
          <div className="mt-4 space-y-2 text-2xs leading-relaxed text-text-muted">
            <p>素材を解析して編集案を作成します。</p>
            <p className="text-text-secondary">例:</p>
            <button
              className="block w-full rounded border border-border px-2 py-1 text-left hover:border-accent hover:text-text"
              onClick={() => {
                addMessage("user", "無音部分を全部削除して");
                void proposeSilenceCut();
              }}
            >
              無音部分を全部削除して
            </button>
          </div>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={clsx(
                "rounded border p-2 text-xs leading-relaxed",
                message.role === "user"
                  ? "border-border bg-panel-alt text-text"
                  : "border-accent/40 bg-accent-muted/30 text-text-secondary",
              )}
            >
              {message.content}
            </div>
          ))
        )}

        {busy ? <p className="text-2xs text-text-muted">解析中…</p> : null}
        {pendingPlan ? <EditPlanCard plan={pendingPlan} /> : null}
        <AIHistoryList />
      </div>

      <div className="shrink-0 border-t border-border p-2">
        <div className="flex gap-1">
          <textarea
            className="h-14 flex-1 resize-none rounded border border-border bg-bg px-2 py-1 text-xs outline-none focus:border-accent"
            placeholder="編集内容を指示…"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                send();
              }
            }}
          />
          <button
            className="toolbar-button h-14 border-accent/60 bg-accent-muted px-3 text-accent disabled:opacity-40"
            onClick={send}
            disabled={busy}
          >
            送信
          </button>
        </div>
      </div>
    </Panel>
  );
}
