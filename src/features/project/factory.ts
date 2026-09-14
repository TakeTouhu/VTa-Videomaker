/** Project and sequence construction / defaults. */

import { DEFAULT_PROJECT_SETTINGS, PROJECT_SCHEMA_VERSION } from "@/types/project";
import type { Project, ProjectSettings } from "@/types/project";
import type { AudioTrack, Sequence, VideoTrack } from "@/types/timeline";
import { createId } from "@/utils/id";

export const DEFAULT_TRACK_HEIGHT = 56;

export function createVideoTrack(index: number): VideoTrack {
  return {
    id: createId("vtrack"),
    kind: "video",
    name: `V${index}`,
    locked: false,
    hidden: false,
    height: DEFAULT_TRACK_HEIGHT,
  };
}

export function createAudioTrack(index: number): AudioTrack {
  return {
    id: createId("atrack"),
    kind: "audio",
    name: `A${index}`,
    locked: false,
    muted: false,
    solo: false,
    height: DEFAULT_TRACK_HEIGHT,
  };
}

export function createSequence(
  name: string,
  settings: ProjectSettings,
  videoTrackCount = 3,
  audioTrackCount = 2,
): Sequence {
  return {
    id: createId("seq"),
    name,
    width: settings.width,
    height: settings.height,
    fps: settings.fps,
    videoTracks: Array.from({ length: videoTrackCount }, (_, i) =>
      createVideoTrack(i + 1),
    ),
    audioTracks: Array.from({ length: audioTrackCount }, (_, i) =>
      createAudioTrack(i + 1),
    ),
    clips: [],
    playhead: 0,
  };
}

export function createProject(
  name = "Untitled Project",
  settings: Partial<ProjectSettings> = {},
): Project {
  const merged: ProjectSettings = { ...DEFAULT_PROJECT_SETTINGS, ...settings };
  const sequence = createSequence("Sequence 01", merged);
  const now = new Date().toISOString();
  return {
    id: createId("proj"),
    name,
    version: PROJECT_SCHEMA_VERSION,
    settings: merged,
    media: [],
    sequences: [sequence],
    activeSequenceId: sequence.id,
    createdAt: now,
    updatedAt: now,
  };
}

export function activeSequence(project: Project): Sequence {
  const found = project.sequences.find((seq) => seq.id === project.activeSequenceId);
  if (!found) {
    const first = project.sequences[0];
    if (!first) throw new Error("Project has no sequences");
    return first;
  }
  return found;
}

export function replaceSequence(project: Project, sequence: Sequence): Project {
  return {
    ...project,
    sequences: project.sequences.map((seq) =>
      seq.id === sequence.id ? sequence : seq,
    ),
    updatedAt: new Date().toISOString(),
  };
}
