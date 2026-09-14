/** Browser implementation of the Backend interface.
 *
 * Everything the desktop build asks FFmpeg for is done here with Web APIs:
 * thumbnails by drawing a seeked frame, waveforms and silence detection with
 * the Web Audio API, tracking on canvas pixels, and export through WebCodecs.
 *
 * Where a capability genuinely is not available in a browser it says so rather
 * than pretending - a proxy file, for instance, has nowhere to live.
 */

import type { Backend, AngleSync, AnalyzeOptions, ExportSettings } from "./backend";
import type { MediaItem, MediaProbe } from "@/types/media";
import type { Project, RecentProject } from "@/types/project";
import type { BackgroundJob } from "@/types/jobs";
import type { MediaAnalysis, TranscriptSegment } from "@/types/ai";
import type { Sequence } from "@/types/timeline";
import type { AppSettings } from "@/store/settingsStore";
import { DEFAULT_SETTINGS } from "@/store/settingsStore";
import { createId } from "@/utils/id";
import * as store from "@/features/web/fileStore";
import * as audio from "@/features/web/audioAnalysis";
import * as frames from "@/features/web/frames";
import * as tracker from "@/features/web/tracking";
import { exportSequence, isSupported as canExport } from "@/features/web/exporter";
import { detectScenes } from "@/features/web/scenes";
import * as speech from "@/features/web/speech";

const SETTINGS_KEY = "ai-video-editor:settings";
const PROJECT_KEY = "ai-video-editor:project";
const TRANSCRIPT_KEY = "ai-video-editor:transcript:";

/** Files awaiting import, keyed by the pseudo-path handed to importMedia. */
const pending = new Map<string, File>();

/** Registers a dropped File and returns the path importMedia expects. */
export function registerBrowserFile(file: File): { path: string; url: string } {
  const path = `browser://${createId("file")}/${file.name}`;
  pending.set(path, file);
  return { path, url: URL.createObjectURL(file) };
}

/* ------------------------------------------------------------------ */
/* Jobs                                                                */
/* ------------------------------------------------------------------ */

const jobs = new Map<string, BackgroundJob>();
const jobListeners = new Set<(job: BackgroundJob) => void>();
const cancellations = new Map<string, AbortController>();

function publish(job: BackgroundJob): void {
  jobs.set(job.id, job);
  for (const listener of jobListeners) listener(job);
}

/* ------------------------------------------------------------------ */

async function probeBlob(blob: Blob, name: string): Promise<MediaProbe> {
  const url = URL.createObjectURL(blob);
  try {
    const isImage = /\.(png|jpe?g|webp|bmp|gif)$/i.test(name);
    if (isImage) {
      // Stills get a nominal duration so they can be placed on a track.
      return { duration: 5, hasVideo: true, hasAudio: false };
    }

    const element = document.createElement("video");
    element.preload = "metadata";
    const metadata = await new Promise<MediaProbe>((resolve, reject) => {
      element.onloadedmetadata = () =>
        resolve({
          duration: Number.isFinite(element.duration) ? element.duration : 0,
          width: element.videoWidth || undefined,
          height: element.videoHeight || undefined,
          hasVideo: element.videoWidth > 0,
          hasAudio: true,
        });
      element.onerror = () => reject(new Error("メディアを読み込めませんでした"));
      element.src = url;
    });

    // The browser reports no audio track flag, so decoding settles it.
    const decoded = await audio.decodeAudio(blob);
    return { ...metadata, hasAudio: decoded !== null };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export const webBackend: Backend = {
  async probeMedia(path) {
    const file = pending.get(path);
    if (!file) throw new Error(`未登録のファイルです: ${path}`);
    return probeBlob(file, file.name);
  },

  async importMedia(paths) {
    const items: MediaItem[] = [];

    for (const path of paths) {
      const file = pending.get(path);
      if (!file) continue;

      const probe = await probeBlob(file, file.name);
      const id = createId("media");
      await store.putFile(id, file);
      pending.delete(path);

      items.push({
        id,
        type: /\.(png|jpe?g|webp|bmp|gif)$/i.test(file.name)
          ? "image"
          : probe.hasVideo
            ? "video"
            : "audio",
        name: file.name,
        sourcePath: path,
        duration: probe.duration,
        width: probe.width,
        height: probe.height,
        audioChannels: probe.hasAudio ? 2 : 0,
        analysisState: "not_started",
        importedAt: new Date().toISOString(),
      });
    }

    // Ask to keep the data rather than have it evicted mid-project.
    void store.requestPersistence();
    return items;
  },

  async generateThumbnail(mediaId, atSeconds) {
    const url = await store.resolveUrl(mediaId);
    if (!url) throw new Error("素材が見つかりません");
    return frames.extractThumbnail(url, atSeconds);
  },

  async generateProxy() {
    // A proxy would have to be re-encoded and stored; in the browser the
    // original is played directly instead.
    throw new Error("ブラウザ版ではプロキシを生成しません");
  },

  async generateWaveform(mediaId) {
    const blob = await store.getFile(mediaId);
    if (!blob) return [];
    const decoded = await audio.decodeAudio(blob);
    return decoded ? audio.waveform(decoded) : [];
  },

  mediaUrl(item) {
    return store.cachedUrl(item.id) ?? "";
  },

  async saveProject(project: Project) {
    window.localStorage.setItem(PROJECT_KEY, JSON.stringify(project));
    return PROJECT_KEY;
  },

  async loadProject() {
    const raw = window.localStorage.getItem(PROJECT_KEY);
    if (!raw) throw new Error("保存されたプロジェクトがありません");

    const project = JSON.parse(raw) as Project;
    // Object URLs do not survive a reload, so every stored file is remapped
    // before the UI asks for one - otherwise the preview comes back blank.
    await Promise.all(project.media.map((item) => store.resolveUrl(item.id)));
    return project;
  },

  async listRecentProjects(): Promise<RecentProject[]> {
    const raw = window.localStorage.getItem(PROJECT_KEY);
    if (!raw) return [];
    const project = JSON.parse(raw) as Project;
    return [
      {
        id: project.id,
        name: project.name,
        path: PROJECT_KEY,
        createdAt: project.createdAt,
        modifiedAt: project.updatedAt,
      },
    ];
  },

  async analyzeMedia(mediaId, options: AnalyzeOptions = {}) {
    const blob = await store.getFile(mediaId);
    if (!blob) throw new Error("素材が見つかりません");

    const decoded = await audio.decodeAudio(blob);
    const url = await store.resolveUrl(mediaId);

    const silences = decoded
      ? audio.detectSilence(decoded, {
          noiseDb: options.silenceNoiseDb ?? audio.DEFAULT_SILENCE_OPTIONS.noiseDb,
          minDurationSeconds:
            options.silenceMinSeconds ?? audio.DEFAULT_SILENCE_OPTIONS.minDurationSeconds,
        })
      : [];

    const scenes = options.scenes && url ? await detectScenes(url) : [];

    const statistics =
      options.statistics && url && decoded
        ? {
            frameStats: await frames.measureFrames(url, decoded.duration),
            loudness: audio.measureLoudness(decoded),
          }
        : {};

    return {
      mediaId,
      transcript: readTranscript(mediaId),
      silences,
      scenes,
      ...statistics,
      analyzedAt: new Date().toISOString(),
    } satisfies MediaAnalysis;
  },

  async extractAudio(mediaId) {
    // The hosted transcription provider reads the file back through this id.
    const blob = await store.getFile(mediaId);
    if (!blob) throw new Error("素材が見つかりません");
    return mediaId;
  },

  async transcribeAudio(mediaId) {
    const blob = await store.getFile(mediaId);
    if (!blob) throw new Error("素材が見つかりません");

    const settings = await this.loadSettings();
    const jobId = createId("job");

    publish({
      id: jobId,
      type: "transcription",
      status: "running",
      progress: 0,
      label: "音声認識",
      mediaId,
    });

    try {
      const segments = await speech.transcribeInBrowser(blob, {
        modelId: settings.speech.model || undefined,
        language: settings.speech.language,
        onProgress: ({ stage, progress }) =>
          publish({
            id: jobId,
            type: "transcription",
            status: "running",
            progress: progress ?? 0,
            label: stage,
            mediaId,
          }),
      });

      publish({
        id: jobId,
        type: "transcription",
        status: "completed",
        progress: 1,
        label: "音声認識が完了しました",
        mediaId,
      });
      return segments;
    } catch (error) {
      publish({
        id: jobId,
        type: "transcription",
        status: "failed",
        progress: 0,
        label: "音声認識",
        mediaId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },

  async saveTranscript(mediaId, segments) {
    window.localStorage.setItem(TRANSCRIPT_KEY + mediaId, JSON.stringify(segments));
  },

  async trackMask(mediaId, startSeconds, durationSeconds, region) {
    const url = await store.resolveUrl(mediaId);
    if (!url) throw new Error("素材が見つかりません");
    return tracker.trackRegion(url, startSeconds, durationSeconds, region);
  },

  async syncMulticam(mediaIds): Promise<AngleSync[]> {
    if (mediaIds.length < 2) throw new Error("同期には2つ以上のアングルが必要です");

    const envelopes: { mediaId: string; values: number[] }[] = [];
    for (const mediaId of mediaIds) {
      const blob = await store.getFile(mediaId);
      const decoded = blob ? await audio.decodeAudio(blob) : null;
      if (!decoded) throw new Error("音声のない素材は同期できません");
      envelopes.push({ mediaId, values: audio.envelope(decoded) });
    }

    const reference = envelopes[0]!;
    const maxLag = 120 * audio.BUCKETS_PER_SECOND;

    return envelopes.map((entry, index) => {
      if (index === 0) return { mediaId: entry.mediaId, offset: 0, confidence: 1 };
      const { lag, confidence } = audio.bestLag(reference.values, entry.values, maxLag);
      return {
        mediaId: entry.mediaId,
        offset: lag / audio.BUCKETS_PER_SECOND,
        confidence,
      };
    });
  },

  async loadSettings(): Promise<AppSettings> {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
  },

  async saveSettings(settings: AppSettings) {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  },

  async resolveApiKey() {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    return raw ? ((JSON.parse(raw) as AppSettings).aiApiKey ?? "") : "";
  },

  async startExport(sequence: Sequence, settings: ExportSettings) {
    if (!canExport()) {
      throw new Error(
        "このブラウザは書き出しに必要なWebCodecsに対応していません。Chrome、Edge、またはSafari 16.4以降をお使いください。",
      );
    }

    const jobId = createId("job");
    const controller = new AbortController();
    cancellations.set(jobId, controller);

    publish({
      id: jobId,
      type: "export",
      status: "running",
      progress: 0,
      label: "Export",
    });

    // Runs in the background: the caller gets the id and follows job events.
    void exportSequence({
      sequence,
      settings,
      signal: controller.signal,
      onProgress: ({ progress, stage }) =>
        publish({
          id: jobId,
          type: "export",
          status: "running",
          progress,
          label: stage === "video" ? "映像を書き出し中" : stage === "audio" ? "音声を書き出し中" : "ファイルを生成中",
        }),
    })
      .then(({ blob, extension }) => {
        downloadBlob(blob, settings.outputPath || "output.mp4", extension);
        publish({
          id: jobId,
          type: "export",
          status: "completed",
          progress: 1,
          label:
            extension === ".webm"
              ? "書き出し完了（WebM形式）"
              : "書き出し完了",
        });
      })
      .catch((error: unknown) => {
        const aborted = error instanceof DOMException && error.name === "AbortError";
        const message = error instanceof Error ? error.message : String(error);

        publish({
          id: jobId,
          type: "export",
          status: aborted ? "cancelled" : "failed",
          progress: 0,
          label: "Export",
          error: aborted ? undefined : message,
        });

        // A failed job alone is easy to miss: without this the user just sees
        // the export never finish.
        if (!aborted) reportExportFailure(message);
      })
      .finally(() => cancellations.delete(jobId));

    return jobId;
  },

  async cancelJob(jobId) {
    cancellations.get(jobId)?.abort();
  },

  async listJobs() {
    return [...jobs.values()];
  },

  onJobUpdate(listener) {
    jobListeners.add(listener);
    return () => jobListeners.delete(listener);
  },
};

/** Surfaces an export failure through the normal error toast. */
function reportExportFailure(message: string): void {
  void import("@/store/uiStore").then(({ useUIStore }) => {
    useUIStore.getState().pushError({
      kind: "render_failed",
      message: "書き出しに失敗しました",
      detail: message,
      recoverable: true,
    });
  });
}

function readTranscript(mediaId: string): TranscriptSegment[] {
  const raw = window.localStorage.getItem(TRANSCRIPT_KEY + mediaId);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as TranscriptSegment[];
  } catch {
    return [];
  }
}

/** Hands the finished file to the browser's download flow. */
function downloadBlob(blob: Blob, filename: string, extension: string): void {
  const base = (filename.split(/[\\/]/).pop() || "output").replace(/\.(mp4|webm)$/i, "");
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${base}${extension}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Give the download a moment to start before releasing the blob.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
