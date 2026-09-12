/** The only boundary between the UI and the Rust core.
 *
 * Design rules 5 and 6: no component builds an FFmpeg command line and no
 * component calls an AI API. Everything goes through this interface, which is
 * backed by Tauri IPC in the desktop app and by a mock in the browser dev
 * server, so the UI can be developed without a Rust build.
 */

import type { MediaItem, MediaProbe } from "@/types/media";
import type { Project, RecentProject } from "@/types/project";
import type { BackgroundJob } from "@/types/jobs";
import type { MediaAnalysis, TranscriptSegment } from "@/types/ai";
import type { Sequence } from "@/types/timeline";
import type { AppSettings } from "@/store/settingsStore";

export interface ExportSettings {
  outputPath: string;
  format: "mp4";
  codec: "h264" | "h265";
  width: number;
  height: number;
  fps: number;
  quality: "low" | "medium" | "high" | "custom";
  /** Only read when quality === "custom". */
  bitrateKbps?: number;
  audioBitrateKbps: number;
}

export interface AnalyzeOptions {
  /** Detect scene boundaries as well as silence. */
  scenes?: boolean;
  /** Silence threshold in dB and minimum duration in seconds. */
  silenceNoiseDb?: number;
  silenceMinSeconds?: number;
  /** Measure picture and loudness statistics for AI correction. */
  statistics?: boolean;
  /** Run the configured object detector over sampled frames. */
  detect?: boolean;
  detectInterval?: number;
}

export interface Backend {
  /* Media */
  probeMedia(path: string): Promise<MediaProbe>;
  importMedia(paths: string[]): Promise<MediaItem[]>;
  generateThumbnail(mediaId: string, atSeconds: number): Promise<string>;
  generateProxy(mediaId: string): Promise<string>;
  generateWaveform(mediaId: string): Promise<number[]>;
  /** file:// (or asset://) URL the <video> element can play. */
  mediaUrl(item: MediaItem, preferProxy: boolean): string;

  /* Project */
  saveProject(project: Project, path?: string): Promise<string>;
  loadProject(path: string): Promise<Project>;
  listRecentProjects(): Promise<RecentProject[]>;

  /* Analysis */
  analyzeMedia(mediaId: string, options?: AnalyzeOptions): Promise<MediaAnalysis>;
  /** Extracts a speech-ready WAV and returns its path. */
  extractAudio(mediaId: string): Promise<string>;
  /** Runs the locally configured speech engine over an extracted WAV. */
  transcribeAudio(audioPath: string): Promise<TranscriptSegment[]>;
  /** Stores a transcript produced by a hosted provider in the media cache. */
  saveTranscript(mediaId: string, segments: TranscriptSegment[]): Promise<void>;

  /* Settings */
  loadSettings(): Promise<AppSettings>;
  saveSettings(settings: AppSettings): Promise<void>;
  /** The unmasked API key, read only when a request is about to be made. */
  resolveApiKey(): Promise<string>;

  /* Render */
  startExport(sequence: Sequence, settings: ExportSettings): Promise<string>;
  cancelJob(jobId: string): Promise<void>;
  listJobs(): Promise<BackgroundJob[]>;
  onJobUpdate(listener: (job: BackgroundJob) => void): () => void;
}

let current: Backend | null = null;

export function setBackend(backend: Backend): void {
  current = backend;
}

export function backend(): Backend {
  if (!current) throw new Error("Backend has not been initialised");
  return current;
}

/** True when running inside the Tauri shell rather than a plain browser. */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
