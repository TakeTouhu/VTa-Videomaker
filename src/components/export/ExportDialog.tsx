import { useEffect, useState } from "react";
import { useUIStore } from "@/store/uiStore";
import {
  FPS_PRESETS,
  RESOLUTION_PRESETS,
  cancelExport,
  defaultExportSettings,
  startExport,
} from "@/services/exportService";
import type { ExportSettings } from "@/services/backend";
import { useEditorStore } from "@/store/editorStore";
import { isTauri } from "@/services/backend";
import { sequenceDuration } from "@/features/timeline/engine";
import { formatDuration } from "@/utils/time";

/** Export settings and progress (design doc sections 37-38). */
export function ExportDialog() {
  const close = () => useUIStore.getState().setExportDialogOpen(false);
  const sequence = useEditorStore((state) => state.sequence());
  const jobs = useUIStore((state) => state.jobs);
  const [settings, setSettings] = useState<ExportSettings>(defaultExportSettings);
  const [jobId, setJobId] = useState<string | null>(null);
  const [format, setFormat] = useState<string | null>(null);

  // In the browser the container depends on which codecs this browser can
  // encode, so the dialog reports what will actually come out rather than
  // promising MP4 and delivering something else.
  useEffect(() => {
    if (isTauri()) return;
    let cancelled = false;

    void import("@/features/web/exporter")
      .then((module) =>
        module.pickEncoderPlan(settings.width, settings.height, settings.fps, 20_000_000),
      )
      .then((plan) => {
        if (!cancelled) {
          setFormat(
            plan.container === "mp4"
              ? "MP4 (H.264 / AAC)"
              : `WebM (${plan.muxerVideoCodec.toUpperCase()} / Opus)`,
          );
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) setFormat(error instanceof Error ? error.message : "利用できません");
      });

    return () => {
      cancelled = true;
    };
  }, [settings.width, settings.height, settings.fps]);

  const job = jobs.find((entry) => entry.id === jobId);
  const patch = (value: Partial<ExportSettings>) =>
    setSettings((current) => ({ ...current, ...value }));

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-[440px] rounded border border-border bg-panel p-4 shadow-xl">
        <h2 className="mb-3 text-sm font-semibold">Export</h2>

        <div className="space-y-2 text-xs">
          <Row label={isTauri() ? "Output" : "ファイル名"}>
            <input
              className="w-full rounded border border-border bg-bg px-2 py-1 text-xs outline-none focus:border-accent"
              placeholder={isTauri() ? "C:\\Videos\\output.mp4" : "output.mp4"}
              value={settings.outputPath}
              onChange={(event) => patch({ outputPath: event.target.value })}
            />
          </Row>

          <Row label="Format">
            <span className="text-text-secondary">
              {isTauri() ? "MP4" : (format ?? "判定中…")}
            </span>
          </Row>

          {isTauri() ? (
          <Row label="Codec">
            <select
              className="rounded border border-border bg-bg px-2 py-1 outline-none"
              value={settings.codec}
              onChange={(event) =>
                patch({ codec: event.target.value as ExportSettings["codec"] })
              }
            >
              <option value="h264">H.264</option>
              <option value="h265">H.265</option>
            </select>
          </Row>
          ) : null}

          <Row label="Resolution">
            <select
              className="rounded border border-border bg-bg px-2 py-1 outline-none"
              value={`${settings.width}x${settings.height}`}
              onChange={(event) => {
                const [width, height] = event.target.value.split("x").map(Number);
                patch({ width: width ?? 1920, height: height ?? 1080 });
              }}
            >
              {RESOLUTION_PRESETS.map((preset) => (
                <option key={preset.label} value={`${preset.width}x${preset.height}`}>
                  {preset.label} ({preset.width}×{preset.height})
                </option>
              ))}
            </select>
          </Row>

          <Row label="FPS">
            <select
              className="rounded border border-border bg-bg px-2 py-1 outline-none"
              value={settings.fps}
              onChange={(event) => patch({ fps: Number(event.target.value) })}
            >
              {FPS_PRESETS.map((preset) => (
                <option
                  key={String(preset)}
                  value={preset === "source" ? sequence.fps : preset}
                >
                  {preset === "source" ? `Source (${sequence.fps})` : preset}
                </option>
              ))}
            </select>
          </Row>

          <Row label="Quality">
            <select
              className="rounded border border-border bg-bg px-2 py-1 outline-none"
              value={settings.quality}
              onChange={(event) =>
                patch({ quality: event.target.value as ExportSettings["quality"] })
              }
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="custom">Custom</option>
            </select>
          </Row>

          {settings.quality === "custom" ? (
            <Row label="Bitrate">
              <input
                type="number"
                className="w-28 rounded border border-border bg-bg px-2 py-1 text-right font-mono outline-none"
                value={settings.bitrateKbps ?? 12000}
                onChange={(event) => patch({ bitrateKbps: Number(event.target.value) })}
              />
            </Row>
          ) : null}

          {isTauri() ? (
          <Row label="GPU">
            <select
              className="rounded border border-border bg-bg px-2 py-1 outline-none"
              value={settings.hardwareAcceleration ?? "none"}
              onChange={(event) =>
                patch({
                  hardwareAcceleration: event.target
                    .value as ExportSettings["hardwareAcceleration"],
                })
              }
            >
              <option value="none">使用しない（ソフトウェア）</option>
              <option value="auto">自動検出</option>
              <option value="nvenc">NVIDIA NVENC</option>
              <option value="qsv">Intel Quick Sync</option>
              <option value="amf">AMD AMF</option>
              <option value="videoToolbox">Apple VideoToolbox</option>
            </select>
          </Row>
          ) : null}

          <Row label="Duration">
            <span className="font-mono text-text-secondary">
              {formatDuration(sequenceDuration(sequence))}
            </span>
          </Row>
        </div>

        {job ? (
          <div className="mt-4">
            <div className="mb-1 flex justify-between text-2xs text-text-secondary">
              <span>Exporting</span>
              <span className="font-mono">{Math.round(job.progress * 100)}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded bg-border">
              <div
                className="h-full bg-accent transition-[width]"
                style={{ width: `${Math.round(job.progress * 100)}%` }}
              />
            </div>
            {job.etaSeconds !== undefined ? (
              <p className="mt-1 text-2xs text-text-muted">
                残り {formatDuration(job.etaSeconds)}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="mt-4 flex justify-end gap-2">
          {job && job.status === "running" ? (
            <button
              className="toolbar-button"
              onClick={() => void cancelExport(job.id)}
            >
              Cancel Export
            </button>
          ) : null}
          <button className="toolbar-button" onClick={close}>
            閉じる
          </button>
          <button
            className="toolbar-button border-accent/60 bg-accent-muted text-accent"
            onClick={async () => {
              const id = await startExport(settings);
              setJobId(id);
            }}
          >
            書き出し
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="field-label w-20 shrink-0">{label}</span>
      <div className="flex-1">{children}</div>
    </div>
  );
}
