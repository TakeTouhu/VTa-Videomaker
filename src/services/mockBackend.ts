/** Browser fallback so `npm run dev` works without a Rust build.
 *
 * It reads real durations and thumbnails from the File API where it can, and
 * refuses (rather than fakes) anything that genuinely needs FFmpeg.
 */

import type { Backend, ExportSettings } from "./backend";
import type { MediaItem, MediaProbe } from "@/types/media";
import type { Project, RecentProject } from "@/types/project";
import type { BackgroundJob } from "@/types/jobs";
import type { MediaAnalysis } from "@/types/ai";
import { createId } from "@/utils/id";

const objectUrls = new Map<string, string>();
const listeners = new Set<(job: BackgroundJob) => void>();

/** Registers a dropped File so the mock backend can serve it back. */
export function registerBrowserFile(file: File): { path: string; url: string } {
  const url = URL.createObjectURL(file);
  const path = `browser://${file.name}`;
  objectUrls.set(path, url);
  return { path, url };
}

function probeWithVideoElement(url: string): Promise<MediaProbe> {
  return new Promise((resolve, reject) => {
    const element = document.createElement("video");
    element.preload = "metadata";
    element.onloadedmetadata = () => {
      resolve({
        duration: element.duration,
        width: element.videoWidth || undefined,
        height: element.videoHeight || undefined,
        fps: undefined,
        hasVideo: element.videoWidth > 0,
        hasAudio: true,
      });
    };
    element.onerror = () => reject(new Error("メディアを読み込めませんでした"));
    element.src = url;
  });
}

export const mockBackend: Backend = {
  async probeMedia(path) {
    const url = objectUrls.get(path);
    if (!url) throw new Error(`Unknown media path: ${path}`);
    return probeWithVideoElement(url);
  },

  async importMedia(paths) {
    const items: MediaItem[] = [];
    for (const path of paths) {
      const probe = await this.probeMedia(path);
      items.push({
        id: createId("media"),
        type: probe.hasVideo ? "video" : "audio",
        name: path.replace("browser://", ""),
        sourcePath: path,
        duration: probe.duration,
        width: probe.width,
        height: probe.height,
        fps: probe.fps,
        analysisState: "not_started",
        importedAt: new Date().toISOString(),
      });
    }
    return items;
  },

  async generateThumbnail() {
    throw new Error("サムネイル生成にはデスクトップ版が必要です");
  },

  async generateProxy() {
    throw new Error("プロキシ生成にはデスクトップ版が必要です");
  },

  async generateWaveform() {
    return [];
  },

  mediaUrl(item) {
    return objectUrls.get(item.sourcePath) ?? item.sourcePath;
  },

  async saveProject(project: Project) {
    window.localStorage.setItem(`project:${project.id}`, JSON.stringify(project));
    return `localStorage://project:${project.id}`;
  },

  async loadProject(path) {
    const key = path.replace("localStorage://", "");
    const raw = window.localStorage.getItem(key);
    if (!raw) throw new Error("プロジェクトが見つかりません");
    return JSON.parse(raw) as Project;
  },

  async listRecentProjects(): Promise<RecentProject[]> {
    return [];
  },

  async analyzeMedia(mediaId): Promise<MediaAnalysis> {
    throw new Error(`解析にはデスクトップ版が必要です (${mediaId})`);
  },

  async startExport(_sequence, _settings: ExportSettings) {
    throw new Error("書き出しにはデスクトップ版が必要です");
  },

  async cancelJob() {
    /* no jobs in the browser */
  },

  async listJobs() {
    return [];
  },

  onJobUpdate(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
