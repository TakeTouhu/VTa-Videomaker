/** Forward migration of project.json between schema versions. */

import { DEFAULT_PROJECT_SETTINGS, PROJECT_SCHEMA_VERSION } from "@/types/project";
import type { Project } from "@/types/project";
import { DEFAULT_COLOR } from "@/types/color";
import { DEFAULT_TRANSFORM } from "@/types/timeline";

/**
 * Normalises a loaded project: fills in fields added after it was written and
 * bumps the version. Unknown future versions are rejected by the caller.
 */
export function migrateProject(raw: Project): Project {
  if (raw.version > PROJECT_SCHEMA_VERSION) {
    throw new Error(
      `このプロジェクトは新しいバージョンで作成されています (v${raw.version})`,
    );
  }

  return {
    ...raw,
    version: PROJECT_SCHEMA_VERSION,
    settings: { ...DEFAULT_PROJECT_SETTINGS, ...raw.settings },
    sequences: raw.sequences.map((sequence) => ({
      ...sequence,
      playhead: sequence.playhead ?? 0,
      clips: sequence.clips.map((clip) => ({
        ...clip,
        kind: clip.kind ?? "media",
        speed: clip.speed || 1,
        transform: { ...DEFAULT_TRANSFORM, ...clip.transform },
        color: { ...DEFAULT_COLOR, ...clip.color },
      })),
    })),
  };
}
