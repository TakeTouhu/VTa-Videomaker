/** Concrete timeline commands (design doc section 32).
 *
 * Each is a thin wrapper that lifts a pure engine function into an undoable
 * EditorCommand operating on the whole project.
 */

import type { Project } from "@/types/project";
import type { Clip, Sequence } from "@/types/timeline";
import type { ColorSettings } from "@/types/color";
import type { AudioSettings, TransformSettings } from "@/types/timeline";
import { activeSequence, replaceSequence } from "@/features/project/factory";
import { snapshotCommand } from "@/features/history/command";
import type { EditorCommand } from "@/features/history/command";
import * as engine from "./engine";

function mapSequence(
  project: Project,
  transform: (sequence: Sequence) => Sequence,
): Project {
  return replaceSequence(project, transform(activeSequence(project)));
}

export function addAdjustmentLayerCommand(
  trackId: string,
  startTime: number,
  duration: number,
): EditorCommand {
  return snapshotCommand({ label: "Add Adjustment Layer" }, (project) =>
    mapSequence(project, (sequence) =>
      engine.insertClip(
        sequence,
        engine.createAdjustmentLayer(trackId, startTime, duration),
      ),
    ),
  );
}

export function addClipCommand(clip: Clip): EditorCommand {
  return snapshotCommand({ label: "Add Clip" }, (project) =>
    mapSequence(project, (sequence) => engine.insertClip(sequence, clip)),
  );
}

export function moveClipCommand(
  clipId: string,
  startTime: number,
  trackId?: string,
): EditorCommand {
  return snapshotCommand({ label: "Move Clip" }, (project) =>
    mapSequence(project, (sequence) =>
      engine.moveClip(sequence, clipId, startTime, {
        trackId,
        fps: sequence.fps,
      }),
    ),
  );
}

export function trimClipCommand(
  clipId: string,
  edge: engine.TrimEdge,
  time: number,
  mediaDuration?: number,
): EditorCommand {
  return snapshotCommand({ label: "Trim Clip" }, (project) =>
    mapSequence(project, (sequence) =>
      engine.trimClip(sequence, clipId, edge, time, mediaDuration),
    ),
  );
}

export function splitClipCommand(clipId: string, time: number): EditorCommand {
  return snapshotCommand({ label: "Split Clip" }, (project) =>
    mapSequence(project, (sequence) => engine.splitClip(sequence, clipId, time).sequence),
  );
}

export function splitAtPlayheadCommand(
  time: number,
  trackIds?: string[],
): EditorCommand {
  return snapshotCommand({ label: "Split" }, (project) =>
    mapSequence(project, (sequence) => engine.splitAt(sequence, time, trackIds).sequence),
  );
}

export function deleteClipsCommand(clipIds: string[]): EditorCommand {
  return snapshotCommand({ label: "Delete Clip" }, (project) =>
    mapSequence(project, (sequence) => engine.deleteClips(sequence, clipIds)),
  );
}

export function rippleDeleteCommand(clipIds: string[]): EditorCommand {
  return snapshotCommand({ label: "Ripple Delete" }, (project) =>
    mapSequence(project, (sequence) => engine.rippleDeleteClips(sequence, clipIds)),
  );
}

export function duplicateClipsCommand(clipIds: string[]): EditorCommand {
  return snapshotCommand({ label: "Duplicate Clip" }, (project) =>
    mapSequence(project, (sequence) => engine.duplicateClips(sequence, clipIds).sequence),
  );
}

export function pasteClipsCommand(clips: Clip[]): EditorCommand {
  return snapshotCommand({ label: "Paste" }, (project) =>
    mapSequence(project, (sequence) =>
      clips.reduce((seq, clip) => engine.insertClip(seq, clip), sequence),
    ),
  );
}

export function changeTransformCommand(
  clipId: string,
  patch: Partial<TransformSettings>,
): EditorCommand {
  return snapshotCommand(
    { label: "Change Transform", mergeKey: `transform:${clipId}` },
    (project) =>
      mapSequence(project, (sequence) => {
        const clip = engine.findClip(sequence, clipId);
        if (!clip) return sequence;
        return engine.updateClip(sequence, clipId, {
          transform: { ...clip.transform, ...patch },
        });
      }),
  );
}

export function changeColorCommand(
  clipId: string,
  patch: Partial<ColorSettings>,
): EditorCommand {
  return snapshotCommand(
    { label: "Change Color", mergeKey: `color:${clipId}` },
    (project) =>
      mapSequence(project, (sequence) => {
        const clip = engine.findClip(sequence, clipId);
        if (!clip) return sequence;
        return engine.updateClip(sequence, clipId, {
          color: { ...clip.color, ...patch },
        });
      }),
  );
}

export function changeAudioCommand(
  clipId: string,
  patch: Partial<AudioSettings>,
): EditorCommand {
  return snapshotCommand(
    { label: "Change Audio", mergeKey: `audio:${clipId}` },
    (project) =>
      mapSequence(project, (sequence) => {
        const clip = engine.findClip(sequence, clipId);
        if (!clip) return sequence;
        const base = clip.audio ?? {
          volume: 0,
          pan: 0,
          fadeIn: 0,
          fadeOut: 0,
          muted: false,
        };
        return engine.updateClip(sequence, clipId, { audio: { ...base, ...patch } });
      }),
  );
}

export function changeSpeedCommand(clipId: string, speed: number): EditorCommand {
  return snapshotCommand(
    { label: "Change Speed", mergeKey: `speed:${clipId}` },
    (project) =>
      mapSequence(project, (sequence) =>
        engine.updateClip(sequence, clipId, { speed: Math.max(0.1, speed) }),
      ),
  );
}

export function removeRangeCommand(
  trackId: string,
  start: number,
  end: number,
  ripple: boolean,
  label = "Remove Range",
): EditorCommand {
  return snapshotCommand({ label }, (project) =>
    mapSequence(project, (sequence) =>
      engine.removeRange(sequence, trackId, start, end, ripple),
    ),
  );
}

/**
 * Wraps a batch of edits into a single undo step. AI edit plans use this so
 * that one Ctrl+Z reverts the whole AI edit (design doc section 32).
 */
export function batchCommand(label: string, commands: EditorCommand[]): EditorCommand {
  return snapshotCommand({ label }, (project) =>
    commands.reduce((state, command) => command.execute(state), project),
  );
}
