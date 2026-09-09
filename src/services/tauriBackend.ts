/** Tauri IPC implementation of the Backend interface. */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { Backend, ExportSettings } from "./backend";
import type { MediaItem, MediaProbe } from "@/types/media";
import type { Project, RecentProject } from "@/types/project";
import type { BackgroundJob } from "@/types/jobs";
import type { MediaAnalysis } from "@/types/ai";
import type { Sequence } from "@/types/timeline";

export const tauriBackend: Backend = {
  probeMedia: (path) => invoke<MediaProbe>("probe_media", { path }),

  importMedia: (paths) => invoke<MediaItem[]>("import_media", { paths }),

  generateThumbnail: (mediaId, atSeconds) =>
    invoke<string>("generate_thumbnail", { mediaId, atSeconds }),

  generateProxy: (mediaId) => invoke<string>("generate_proxy", { mediaId }),

  generateWaveform: (mediaId) => invoke<number[]>("generate_waveform", { mediaId }),

  mediaUrl: (item: MediaItem, preferProxy: boolean) =>
    convertFileSrc(preferProxy && item.proxyPath ? item.proxyPath : item.sourcePath),

  saveProject: (project: Project, path?: string) =>
    invoke<string>("save_project", { project, path: path ?? null }),

  loadProject: (path) => invoke<Project>("load_project", { path }),

  listRecentProjects: () => invoke<RecentProject[]>("list_recent_projects"),

  analyzeMedia: (mediaId) => invoke<MediaAnalysis>("analyze_media", { mediaId }),

  startExport: (sequence: Sequence, settings: ExportSettings) =>
    invoke<string>("start_export", { sequence, settings }),

  cancelJob: (jobId) => invoke<void>("cancel_job", { jobId }),

  listJobs: () => invoke<BackgroundJob[]>("list_jobs"),

  onJobUpdate(listener) {
    const unlisten = listen<BackgroundJob>("job://update", (event) => {
      listener(event.payload);
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  },
};
