/** Commands for masks, effects, keyframes, transitions, text and multicam
 *  (design doc section 58). Each is a normal undoable EditorCommand. */

import type { Project } from "@/types/project";
import type { Clip, Sequence } from "@/types/timeline";
import { DEFAULT_TEXT } from "@/types/effects";
import type {
  AnimatableProperty,
  Effect,
  EffectType,
  Interpolation,
  Mask,
  MaskShape,
  MulticamGroup,
  TextSettings,
  Transition,
  TransitionType,
} from "@/types/effects";
import {
  DEFAULT_ELLIPSE,
  DEFAULT_TRANSITION_DURATION,
  defaultEffectParameters,
} from "@/types/effects";
import { activeSequence, replaceSequence } from "@/features/project/factory";
import { snapshotCommand } from "@/features/history/command";
import type { EditorCommand } from "@/features/history/command";
import * as engine from "./engine";
import { removeKeyframe, setKeyframe, staticValue } from "./keyframes";
import { createId } from "@/utils/id";

function mapSequence(
  project: Project,
  transform: (sequence: Sequence) => Sequence,
): Project {
  return replaceSequence(project, transform(activeSequence(project)));
}

function mapClip(
  project: Project,
  clipId: string,
  transform: (clip: Clip) => Clip,
): Project {
  return mapSequence(project, (sequence) => {
    const clip = engine.findClip(sequence, clipId);
    if (!clip || engine.isTrackLocked(sequence, clip.trackId)) return sequence;
    return {
      ...sequence,
      clips: sequence.clips.map((entry) =>
        entry.id === clipId ? transform(entry) : entry,
      ),
    };
  });
}

/* ------------------------------------------------------------------ */
/* Masks                                                               */
/* ------------------------------------------------------------------ */

export function addMaskCommand(clipId: string, shape: MaskShape = DEFAULT_ELLIPSE): EditorCommand {
  return snapshotCommand({ label: "Add Mask" }, (project) =>
    mapClip(project, clipId, (clip) => ({
      ...clip,
      masks: [
        ...(clip.masks ?? []),
        {
          id: createId("mask"),
          name: `マスク ${(clip.masks?.length ?? 0) + 1}`,
          shape,
          feather: 0.03,
          expansion: 0,
          opacity: 1,
          inverted: false,
          enabled: true,
          track: [],
        },
      ],
    })),
  );
}

export function updateMaskCommand(
  clipId: string,
  maskId: string,
  patch: Partial<Mask>,
): EditorCommand {
  return snapshotCommand(
    { label: "Edit Mask", mergeKey: `mask:${maskId}` },
    (project) =>
      mapClip(project, clipId, (clip) => ({
        ...clip,
        masks: (clip.masks ?? []).map((mask) =>
          mask.id === maskId ? { ...mask, ...patch } : mask,
        ),
      })),
  );
}

export function removeMaskCommand(clipId: string, maskId: string): EditorCommand {
  return snapshotCommand({ label: "Remove Mask" }, (project) =>
    mapClip(project, clipId, (clip) => ({
      ...clip,
      masks: (clip.masks ?? []).filter((mask) => mask.id !== maskId),
    })),
  );
}

/* ------------------------------------------------------------------ */
/* Effects                                                             */
/* ------------------------------------------------------------------ */

export function addEffectCommand(clipId: string, type: EffectType): EditorCommand {
  return snapshotCommand({ label: "Add Effect" }, (project) =>
    mapClip(project, clipId, (clip) => ({
      ...clip,
      effects: [
        ...(clip.effects ?? []),
        {
          id: createId("fx"),
          type,
          enabled: true,
          parameters: defaultEffectParameters(type),
        },
      ],
    })),
  );
}

export function updateEffectCommand(
  clipId: string,
  effectId: string,
  patch: Partial<Effect>,
): EditorCommand {
  return snapshotCommand(
    { label: "Edit Effect", mergeKey: `fx:${effectId}` },
    (project) =>
      mapClip(project, clipId, (clip) => ({
        ...clip,
        effects: (clip.effects ?? []).map((effect) =>
          effect.id === effectId ? { ...effect, ...patch } : effect,
        ),
      })),
  );
}

export function removeEffectCommand(clipId: string, effectId: string): EditorCommand {
  return snapshotCommand({ label: "Remove Effect" }, (project) =>
    mapClip(project, clipId, (clip) => ({
      ...clip,
      effects: (clip.effects ?? []).filter((effect) => effect.id !== effectId),
    })),
  );
}

export function reorderEffectCommand(
  clipId: string,
  effectId: string,
  direction: -1 | 1,
): EditorCommand {
  return snapshotCommand({ label: "Reorder Effect" }, (project) =>
    mapClip(project, clipId, (clip) => {
      const effects = [...(clip.effects ?? [])];
      const index = effects.findIndex((effect) => effect.id === effectId);
      const target = index + direction;
      if (index === -1 || target < 0 || target >= effects.length) return clip;

      const [moved] = effects.splice(index, 1);
      effects.splice(target, 0, moved!);
      return { ...clip, effects };
    }),
  );
}

/* ------------------------------------------------------------------ */
/* Keyframes                                                           */
/* ------------------------------------------------------------------ */

/** Adds a keyframe at the playhead, seeding it from the current value. */
export function addKeyframeCommand(
  clipId: string,
  property: AnimatableProperty,
  sequenceTime: number,
  value?: number,
  interpolation: Interpolation = "linear",
): EditorCommand {
  return snapshotCommand({ label: "Add Keyframe" }, (project) =>
    mapClip(project, clipId, (clip) => {
      const speed = clip.speed > 0 ? clip.speed : 1;
      const local = (sequenceTime - clip.startTime) * speed;
      return {
        ...clip,
        keyframes: setKeyframe(
          clip,
          property,
          local,
          value ?? staticValue(clip, property),
          interpolation,
        ),
      };
    }),
  );
}

export function removeKeyframeCommand(
  clipId: string,
  property: AnimatableProperty,
  sequenceTime: number,
): EditorCommand {
  return snapshotCommand({ label: "Remove Keyframe" }, (project) =>
    mapClip(project, clipId, (clip) => {
      const speed = clip.speed > 0 ? clip.speed : 1;
      const local = (sequenceTime - clip.startTime) * speed;
      return { ...clip, keyframes: removeKeyframe(clip, property, local) };
    }),
  );
}

export function clearKeyframesCommand(
  clipId: string,
  property: AnimatableProperty,
): EditorCommand {
  return snapshotCommand({ label: "Clear Keyframes" }, (project) =>
    mapClip(project, clipId, (clip) => ({
      ...clip,
      keyframes: (clip.keyframes ?? []).filter((track) => track.property !== property),
    })),
  );
}

/** Stores tracker output on a mask (design doc section 17). */
export function setMaskTrackCommand(
  clipId: string,
  maskId: string,
  track: Mask["track"],
): EditorCommand {
  return snapshotCommand({ label: "Track Mask" }, (project) =>
    mapClip(project, clipId, (clip) => ({
      ...clip,
      masks: (clip.masks ?? []).map((mask) =>
        mask.id === maskId ? { ...mask, track } : mask,
      ),
    })),
  );
}

/* ------------------------------------------------------------------ */
/* Transitions                                                         */
/* ------------------------------------------------------------------ */

/**
 * Adds a transition at the cut between two adjacent clips. The duration is
 * capped so a transition can never be longer than the clips it joins.
 */
export function addTransitionCommand(
  fromClipId: string,
  toClipId: string,
  type: TransitionType = "crossDissolve",
  duration = DEFAULT_TRANSITION_DURATION,
): EditorCommand {
  return snapshotCommand({ label: "Add Transition" }, (project) =>
    mapSequence(project, (sequence) => {
      const from = engine.findClip(sequence, fromClipId);
      const to = engine.findClip(sequence, toClipId);
      if (!from || !to || from.trackId !== to.trackId) return sequence;

      const capped = Math.min(
        duration,
        engine.clipDuration(from) * 0.9,
        engine.clipDuration(to) * 0.9,
      );
      if (capped <= 0.05) return sequence;

      const transition: Transition = {
        id: createId("trans"),
        trackId: from.trackId,
        fromClipId,
        toClipId,
        type,
        duration: capped,
      };

      const existing = (sequence.transitions ?? []).filter(
        (entry) => !(entry.fromClipId === fromClipId && entry.toClipId === toClipId),
      );
      return { ...sequence, transitions: [...existing, transition] };
    }),
  );
}

export function updateTransitionCommand(
  transitionId: string,
  patch: Partial<Transition>,
): EditorCommand {
  return snapshotCommand(
    { label: "Edit Transition", mergeKey: `trans:${transitionId}` },
    (project) =>
      mapSequence(project, (sequence) => ({
        ...sequence,
        transitions: (sequence.transitions ?? []).map((transition) =>
          transition.id === transitionId ? { ...transition, ...patch } : transition,
        ),
      })),
  );
}

export function removeTransitionCommand(transitionId: string): EditorCommand {
  return snapshotCommand({ label: "Remove Transition" }, (project) =>
    mapSequence(project, (sequence) => ({
      ...sequence,
      transitions: (sequence.transitions ?? []).filter(
        (transition) => transition.id !== transitionId,
      ),
    })),
  );
}

/* ------------------------------------------------------------------ */
/* Text                                                                */
/* ------------------------------------------------------------------ */

export function addTextClipCommand(
  trackId: string,
  startTime: number,
  duration = 5,
  text: Partial<TextSettings> = {},
): EditorCommand {
  return snapshotCommand({ label: "Add Text" }, (project) =>
    mapSequence(project, (sequence) =>
      engine.insertClip(sequence, {
        ...engine.createClip({
          mediaId: null,
          trackId,
          startTime,
          sourceIn: 0,
          sourceOut: duration,
          kind: "text",
          withAudio: false,
          label: text.content ?? DEFAULT_TEXT.content,
        }),
        text: { ...DEFAULT_TEXT, ...text },
      }),
    ),
  );
}

export function updateTextCommand(
  clipId: string,
  patch: Partial<TextSettings>,
): EditorCommand {
  return snapshotCommand(
    { label: "Edit Text", mergeKey: `text:${clipId}` },
    (project) =>
      mapClip(project, clipId, (clip) => ({
        ...clip,
        text: { ...DEFAULT_TEXT, ...clip.text, ...patch },
        label: patch.content ?? clip.label,
      })),
  );
}

/* ------------------------------------------------------------------ */
/* Multicam                                                            */
/* ------------------------------------------------------------------ */

export function setMulticamGroupCommand(group: MulticamGroup): EditorCommand {
  return snapshotCommand({ label: "Sync Multicam" }, (project) => {
    const existing = project.multicamGroups ?? [];
    const index = existing.findIndex((entry) => entry.id === group.id);
    return {
      ...project,
      multicamGroups:
        index === -1
          ? [...existing, group]
          : existing.map((entry) => (entry.id === group.id ? group : entry)),
    };
  });
}

/**
 * Switches a multicam clip to another angle at the playhead: the clip is split
 * there and the later half points at the new angle's media.
 */
export function switchAngleCommand(
  clipId: string,
  sequenceTime: number,
  angleIndex: number,
): EditorCommand {
  return snapshotCommand({ label: "Switch Angle" }, (project) => {
    const group = (project.multicamGroups ?? []).find((entry) =>
      entry.angles.length > angleIndex,
    );
    const angle = group?.angles[angleIndex];
    if (!group || !angle) return project;

    return mapSequence(project, (sequence) => {
      const clip = engine.findClip(sequence, clipId);
      if (!clip) return sequence;

      const split = engine.splitClip(sequence, clipId, sequenceTime);
      const targetId = split.newClipIds[1] ?? clipId;

      return {
        ...split.sequence,
        clips: split.sequence.clips.map((entry) =>
          entry.id === targetId
            ? {
                ...entry,
                mediaId: angle.mediaId,
                label: angle.name,
                multicam: { groupId: group.id, angleIndex },
              }
            : entry,
        ),
      };
    });
  });
}
