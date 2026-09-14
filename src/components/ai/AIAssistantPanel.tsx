import { useState } from "react";
import clsx from "clsx";
import { Panel } from "@/components/ui/Panel";
import { EditPlanCard } from "./EditPlanCard";
import { AIHistoryList } from "./AIHistoryList";
import { useAIStore } from "@/store/aiStore";
import type { AIEditMode } from "@/store/aiStore";
import { analyzeSequenceMedia, requestEdit } from "@/services/aiService";
import { TranscriptPanel } from "./TranscriptPanel";
import { CaptionEditor } from "./CaptionEditor";
import { useSettingsStore } from "@/store/settingsStore";

interface AIAssistantPanelProps {
  className?: string;
}

/** Example requests shown in an empty chat (design doc section 24). */
const SUGGESTIONS = [
  "無音部分を全部削除して",
  "言い直しを削除して",
  "3分以内にまとめて",
  "一番良いテイクだけ残して",
  "ハイライトを60秒でまとめて",
  "色を自動補正して",
  "音量を揃えて",
  "字幕を作って",
];

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
  const [tab, setTab] = useState<"chat" | "transcript" | "captions">("chat");
  const provider = useSettingsStore((state) => state.settings.aiProvider);

  const send = (text: string = input) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setInput("");
    addMessage("user", trimmed);
    void requestEdit(trimmed);
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
      <div className="flex shrink-0 border-b border-border">
        {(["chat", "transcript", "captions"] as const).map((entry) => (
          <button
            key={entry}
            className={clsx(
              "flex-1 border-b-2 px-2 py-1 text-2xs uppercase tracking-wide",
              tab === entry
                ? "border-accent text-accent"
                : "border-transparent text-text-secondary hover:text-text",
            )}
            onClick={() => setTab(entry)}
          >
            {entry === "chat" ? "Chat" : entry === "transcript" ? "文字起こし" : "字幕"}
          </button>
        ))}
      </div>

      {tab === "transcript" ? (
        <TranscriptPanel />
      ) : tab === "captions" ? (
        <CaptionEditor />
      ) : (
      <>
      <div className="min-h-0 flex-1 space-y-2 overflow-auto p-2">
        {messages.length === 0 ? (
          <div className="mt-4 space-y-2 text-2xs leading-relaxed text-text-muted">
            <p>素材を解析して編集案を作成します。</p>
            <p className="text-text-secondary">例:</p>
            {SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                className="block w-full rounded border border-border px-2 py-1 text-left hover:border-accent hover:text-text"
                onClick={() => send(suggestion)}
              >
                {suggestion}
              </button>
            ))}
            <p className="pt-1 leading-relaxed text-text-muted">
              {provider === "local"
                ? "上記はすべてブラウザ内で処理され、APIキーは不要です。文字起こしが必要な指示では、初回のみモデルのダウンロードが発生します。"
                : "自由な指示を入力できます。"}
            </p>
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
        <button
          className="mb-1 w-full rounded border border-border px-2 py-1 text-2xs text-text-secondary hover:border-accent hover:text-text disabled:opacity-40"
          disabled={busy}
          onClick={() => void analyzeSequenceMedia({ transcribe: true, force: true })}
        >
          素材を解析（無音・シーン・文字起こし）
        </button>
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
            onClick={() => send()}
            disabled={busy}
          >
            送信
          </button>
        </div>
      </div>
      </>
      )}
    </Panel>
  );
}
