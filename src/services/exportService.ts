/** Export orchestration (design doc sections 37, 38).
 *
 * The UI passes the sequence and the settings; building the FFmpeg graph is
 * entirely the Rust core's job.
 */

import { backend, isTauri } from "./backend";
import type { ExportSettings } from "./backend";
import { useEditorStore } from "@/store/editorStore";
import { useUIStore } from "@/store/uiStore";
import { appError, userMessage } from "@/types/errors";

export const RESOLUTION_PRESETS = [
  { label: "720p", width: 1280, height: 720 },
  { label: "1080p", width: 1920, height: 1080 },
  { label: "1440p", width: 2560, height: 1440 },
  { label: "4K", width: 3840, height: 2160 },
] as const;

export const FPS_PRESETS = ["source", 24, 25, 30, 60] as const;

export const QUALITY_BITRATES: Record<"low" | "medium" | "high", number> = {
  low: 4000,
  medium: 10000,
  high: 20000,
};

export function defaultExportSettings(): ExportSettings {
  const state = useEditorStore.getState();
  const sequence = state.sequence();
  // In the browser the output is a download name, not a path, so it always
  // starts filled in - there is nothing for the user to browse to.
  const safeName = state.project.name.replace(/[\\/:*?"<>|]/g, "_").trim() || "output";

  return {
    outputPath: isTauri() ? "" : `${safeName}.mp4`,
    format: "mp4",
    codec: "h264",
    width: sequence.width,
    height: sequence.height,
    fps: sequence.fps,
    quality: "high",
    audioBitrateKbps: 192,
    hardwareAcceleration: "none",
  };
}

/** Starts an export job and returns its id, or null when it could not start. */
export async function startExport(settings: ExportSettings): Promise<string | null> {
  const ui = useUIStore.getState();
  const sequence = useEditorStore.getState().sequence();

  if (sequence.clips.length === 0) {
    ui.pushError(appError("render_failed", "タイムラインが空です"));
    return null;
  }
  if (!settings.outputPath) {
    ui.pushError(appError("render_failed", "書き出し先を指定してください"));
    return null;
  }

  try {
    const jobId = await backend().startExport(sequence, settings);
    ui.setStatus("書き出しを開始しました");
    return jobId;
  } catch (error) {
    ui.pushError(
      appError("render_failed", userMessage("render_failed"), String(error)),
    );
    return null;
  }
}

export async function cancelExport(jobId: string): Promise<void> {
  await backend().cancelJob(jobId);
  useUIStore.getState().setStatus("書き出しをキャンセルしました");
}
