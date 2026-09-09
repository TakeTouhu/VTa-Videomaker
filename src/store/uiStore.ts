/** Panel / view state that is not part of the project document. */

import { create } from "zustand";
import type { BackgroundJob } from "@/types/jobs";
import type { AppError } from "@/types/errors";

export type MediaViewMode = "grid" | "list";
export type InspectorTab = "effect" | "color" | "audio";

export interface UIState {
  mediaView: MediaViewMode;
  mediaSearch: string;
  inspectorTab: InspectorTab;
  aiPanelOpen: boolean;
  exportDialogOpen: boolean;
  /** Pixels per second on the timeline. */
  zoom: number;
  scrollX: number;
  jobs: BackgroundJob[];
  errors: AppError[];
  statusMessage: string | null;

  setMediaView(mode: MediaViewMode): void;
  setMediaSearch(query: string): void;
  setInspectorTab(tab: InspectorTab): void;
  toggleAIPanel(): void;
  setExportDialogOpen(open: boolean): void;
  setZoom(zoom: number): void;
  zoomIn(): void;
  zoomOut(): void;
  setScrollX(scrollX: number): void;
  upsertJob(job: BackgroundJob): void;
  setJobs(jobs: BackgroundJob[]): void;
  pushError(error: AppError): void;
  dismissError(index: number): void;
  setStatus(message: string | null): void;
}

export const MIN_ZOOM = 2;
export const MAX_ZOOM = 400;
const ZOOM_STEP = 1.25;

export const useUIStore = create<UIState>((set) => ({
  mediaView: "grid",
  mediaSearch: "",
  inspectorTab: "effect",
  aiPanelOpen: true,
  exportDialogOpen: false,
  zoom: 40,
  scrollX: 0,
  jobs: [],
  errors: [],
  statusMessage: null,

  setMediaView: (mediaView) => set({ mediaView }),
  setMediaSearch: (mediaSearch) => set({ mediaSearch }),
  setInspectorTab: (inspectorTab) => set({ inspectorTab }),
  toggleAIPanel: () => set((state) => ({ aiPanelOpen: !state.aiPanelOpen })),
  setExportDialogOpen: (exportDialogOpen) => set({ exportDialogOpen }),
  setZoom: (zoom) => set({ zoom: clampZoom(zoom) }),
  zoomIn: () => set((state) => ({ zoom: clampZoom(state.zoom * ZOOM_STEP) })),
  zoomOut: () => set((state) => ({ zoom: clampZoom(state.zoom / ZOOM_STEP) })),
  setScrollX: (scrollX) => set({ scrollX: Math.max(0, scrollX) }),

  upsertJob: (job) =>
    set((state) => {
      const index = state.jobs.findIndex((existing) => existing.id === job.id);
      if (index === -1) return { jobs: [...state.jobs, job] };
      const jobs = [...state.jobs];
      jobs[index] = job;
      return { jobs };
    }),

  setJobs: (jobs) => set({ jobs }),
  pushError: (error) => set((state) => ({ errors: [...state.errors, error] })),
  dismissError: (index) =>
    set((state) => ({ errors: state.errors.filter((_, i) => i !== index) })),
  setStatus: (statusMessage) => set({ statusMessage }),
}));

function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}
