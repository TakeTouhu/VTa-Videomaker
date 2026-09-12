import { useState } from "react";
import { useSettingsStore } from "@/store/settingsStore";
import type { AppSettings } from "@/store/settingsStore";
import { saveSettings } from "@/services/settingsService";

/** AI provider and local engine configuration. Keys never enter project.json. */
export function SettingsDialog() {
  const stored = useSettingsStore((state) => state.settings);
  const close = () => useSettingsStore.getState().setDialogOpen(false);
  const [draft, setDraft] = useState<AppSettings>(stored);

  const patch = (value: Partial<AppSettings>) =>
    setDraft((current) => ({ ...current, ...value }));

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="max-h-[90%] w-[520px] overflow-auto rounded border border-border bg-panel p-4 shadow-xl">
        <h2 className="mb-3 text-sm font-semibold">設定</h2>

        <section className="mb-4">
          <h3 className="mb-2 border-b border-border pb-1 text-2xs uppercase tracking-wider text-text-secondary">
            AI プロバイダ
          </h3>

          <Row label="Provider">
            <select
              className="w-full rounded border border-border bg-bg px-2 py-1 text-xs outline-none"
              value={draft.aiProvider}
              onChange={(event) =>
                patch({ aiProvider: event.target.value as AppSettings["aiProvider"] })
              }
            >
              <option value="local">ローカル（組み込みの編集プランのみ）</option>
              <option value="openai">OpenAI互換API</option>
            </select>
          </Row>

          {draft.aiProvider === "openai" ? (
            <>
              <Row label="Endpoint">
                <input
                  className="w-full rounded border border-border bg-bg px-2 py-1 text-xs outline-none focus:border-accent"
                  placeholder="https://api.openai.com/v1"
                  value={draft.aiEndpoint}
                  onChange={(event) => patch({ aiEndpoint: event.target.value })}
                />
              </Row>
              <Row label="Model">
                <input
                  className="w-full rounded border border-border bg-bg px-2 py-1 text-xs outline-none focus:border-accent"
                  placeholder="gpt-4o"
                  value={draft.aiModel}
                  onChange={(event) => patch({ aiModel: event.target.value })}
                />
              </Row>
              <Row label="API Key">
                <input
                  type="password"
                  className="w-full rounded border border-border bg-bg px-2 py-1 text-xs outline-none focus:border-accent"
                  placeholder="sk-..."
                  value={draft.aiApiKey}
                  onChange={(event) => patch({ aiApiKey: event.target.value })}
                />
              </Row>
              <p className="mt-1 text-2xs leading-relaxed text-text-muted">
                APIキーはプロジェクトファイルには保存されず、この端末の設定ファイルにのみ保存されます。
              </p>
            </>
          ) : (
            <p className="mt-1 text-2xs leading-relaxed text-text-muted">
              ローカルモードでは「無音を削除」「言い直しを削除」「○分にまとめる」に対応します。
            </p>
          )}
        </section>

        <section className="mb-4">
          <h3 className="mb-2 border-b border-border pb-1 text-2xs uppercase tracking-wider text-text-secondary">
            音声認識（ローカル）
          </h3>
          <Row label="実行ファイル">
            <input
              className="w-full rounded border border-border bg-bg px-2 py-1 text-xs outline-none focus:border-accent"
              placeholder="C:\\tools\\whisper-cli.exe"
              value={draft.speech.binary}
              onChange={(event) =>
                patch({ speech: { ...draft.speech, binary: event.target.value } })
              }
            />
          </Row>
          <Row label="モデル">
            <input
              className="w-full rounded border border-border bg-bg px-2 py-1 text-xs outline-none focus:border-accent"
              placeholder="ggml-large-v3.bin"
              value={draft.speech.model}
              onChange={(event) =>
                patch({ speech: { ...draft.speech, model: event.target.value } })
              }
            />
          </Row>
          <Row label="言語">
            <input
              className="w-full rounded border border-border bg-bg px-2 py-1 text-xs outline-none focus:border-accent"
              placeholder="auto / ja / en"
              value={draft.speech.language}
              onChange={(event) =>
                patch({ speech: { ...draft.speech, language: event.target.value } })
              }
            />
          </Row>
          <p className="mt-1 text-2xs leading-relaxed text-text-muted">
            SRTを出力するwhisper.cpp系の実行ファイルに対応します。未設定の場合は
            OpenAI互換APIでの文字起こしを使用します。
          </p>
        </section>

        <section className="mb-4">
          <h3 className="mb-2 border-b border-border pb-1 text-2xs uppercase tracking-wider text-text-secondary">
            物体検出（任意）
          </h3>
          <Row label="実行ファイル">
            <input
              className="w-full rounded border border-border bg-bg px-2 py-1 text-xs outline-none focus:border-accent"
              placeholder="detector.exe"
              value={draft.detectorBinary}
              onChange={(event) => patch({ detectorBinary: event.target.value })}
            />
          </Row>
          <p className="mt-1 text-2xs leading-relaxed text-text-muted">
            JSONで検出結果を返す外部コマンド。未設定でも他の機能は使用できます。
          </p>
        </section>

        <div className="flex justify-end gap-2">
          <button className="toolbar-button" onClick={close}>
            キャンセル
          </button>
          <button
            className="toolbar-button border-accent/60 bg-accent-muted text-accent"
            onClick={async () => {
              await saveSettings(draft);
              close();
            }}
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mb-2 flex items-center gap-3">
      <span className="field-label w-24 shrink-0">{label}</span>
      <span className="flex-1">{children}</span>
    </label>
  );
}
