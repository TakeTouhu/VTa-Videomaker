/** Project document model (design doc section 27). Persisted as project.json. */

import type { MediaItem } from "./media";
import type { Sequence } from "./timeline";

/** Bumped whenever the on-disk shape changes; migrations live in features/project. */
export const PROJECT_SCHEMA_VERSION = 1;

export interface ProjectSettings {
  width: number;
  height: number;
  fps: number;
  sampleRate: number;
  /** Use proxy media for preview when available (section 34). */
  useProxies: boolean;
  autosaveIntervalMs: number;
}

export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = {
  width: 1920,
  height: 1080,
  fps: 30,
  sampleRate: 48000,
  useProxies: true,
  autosaveIntervalMs: 30_000,
};

export interface Project {
  id: string;
  name: string;
  /** Schema version, not a user facing revision. */
  version: number;
  settings: ProjectSettings;
  media: MediaItem[];
  sequences: Sequence[];
  activeSequenceId: string;
  createdAt: string;
  updatedAt: string;
}

export interface RecentProject {
  id: string;
  name: string;
  path: string;
  thumbnailPath?: string;
  createdAt: string;
  modifiedAt: string;
}
