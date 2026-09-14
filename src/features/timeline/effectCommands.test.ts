import { describe, expect, it } from "vitest";
import * as fx from "./effectCommands";
import * as engine from "./engine";
import * as history from "@/features/history/historyManager";
import { activeSequence, createProject } from "@/features/project/factory";
import type { Project } from "@/types/project";

function projectWithClips(): { project: Project; trackId: string; ids: string[] } {
  const base = createProject("Effects test");
  const sequence = activeSequence(base);
  const trackId = sequence.videoTracks[0]!.id;

  const a = engine.createClip({
    mediaId: "m1",
    trackId,
    startTime: 0,
    sourceIn: 0,
    sourceOut: 5,
    id: "clip_a",
  });
  const b = engine.createClip({
    mediaId: "m1",
    trackId,
    startTime: 5,
    sourceIn: 5,
    sourceOut: 10,
    id: "clip_b",
  });

  return {
    project: {
      ...base,
      sequences: base.sequences.map((seq) =>
        seq.id === sequence.id ? { ...seq, clips: [a, b] } : seq,
      ),
    },
    trackId,
    ids: [a.id, b.id],
  };
}

function run(project: Project, command: ReturnType<typeof fx.addMaskCommand>) {
  return history.execute(project, history.emptyHistory(), command);
}

describe("effect commands", () => {
  it("adds and removes an effect", () => {
    const { project, ids } = projectWithClips();
    const added = run(project, fx.addEffectCommand(ids[0]!, "blur"));
    const clip = activeSequence(added.project).clips[0]!;
    expect(clip.effects).toHaveLength(1);
    expect(clip.effects![0]!.parameters.amount).toBe(5);

    const removed = run(added.project, fx.removeEffectCommand(ids[0]!, clip.effects![0]!.id));
    expect(activeSequence(removed.project).clips[0]!.effects).toHaveLength(0);
  });

  it("reorders effects", () => {
    const { project, ids } = projectWithClips();
    let state = run(project, fx.addEffectCommand(ids[0]!, "blur"));
    state = run(state.project, fx.addEffectCommand(ids[0]!, "sharpen"));

    const before = activeSequence(state.project).clips[0]!.effects!;
    const moved = run(state.project, fx.reorderEffectCommand(ids[0]!, before[1]!.id, -1));
    expect(activeSequence(moved.project).clips[0]!.effects![0]!.type).toBe("sharpen");
  });

  it("ignores a reorder past the ends of the stack", () => {
    const { project, ids } = projectWithClips();
    const state = run(project, fx.addEffectCommand(ids[0]!, "blur"));
    const effectId = activeSequence(state.project).clips[0]!.effects![0]!.id;

    const moved = run(state.project, fx.reorderEffectCommand(ids[0]!, effectId, -1));
    expect(activeSequence(moved.project).clips[0]!.effects).toHaveLength(1);
  });

  it("every effect edit is undoable", () => {
    const { project, ids } = projectWithClips();
    const added = run(project, fx.addEffectCommand(ids[0]!, "vignette"));
    const undone = history.undo(added.project, added.history);
    expect(undone.project).toEqual(project);
  });
});

describe("mask commands", () => {
  it("adds a mask with sensible defaults", () => {
    const { project, ids } = projectWithClips();
    const added = run(project, fx.addMaskCommand(ids[0]!));
    const mask = activeSequence(added.project).clips[0]!.masks![0]!;
    expect(mask.enabled).toBe(true);
    expect(mask.opacity).toBe(1);
    expect(mask.shape.kind).toBe("ellipse");
  });

  it("stores tracker samples on a mask", () => {
    const { project, ids } = projectWithClips();
    const added = run(project, fx.addMaskCommand(ids[0]!));
    const maskId = activeSequence(added.project).clips[0]!.masks![0]!.id;

    const tracked = run(
      added.project,
      fx.setMaskTrackCommand(ids[0]!, maskId, [
        { time: 0, offsetX: 0, offsetY: 0, scale: 1, confidence: 1 },
        { time: 0.1, offsetX: 0.02, offsetY: 0, scale: 1, confidence: 0.9 },
      ]),
    );
    expect(activeSequence(tracked.project).clips[0]!.masks![0]!.track).toHaveLength(2);
  });
});

describe("transition commands", () => {
  it("adds a transition between adjacent clips", () => {
    const { project, ids } = projectWithClips();
    const added = run(project, fx.addTransitionCommand(ids[0]!, ids[1]!));
    expect(activeSequence(added.project).transitions).toHaveLength(1);
  });

  it("caps the duration to what the clips can give", () => {
    const { project, ids } = projectWithClips();
    // The clips are 5s each, so a 30s transition is impossible.
    const added = run(project, fx.addTransitionCommand(ids[0]!, ids[1]!, "wipeLeft", 30));
    expect(activeSequence(added.project).transitions![0]!.duration).toBeLessThanOrEqual(4.5);
  });

  it("refuses a transition between clips on different tracks", () => {
    const { project, ids } = projectWithClips();
    const sequence = activeSequence(project);
    const otherTrack = sequence.videoTracks[1]!.id;

    const moved = {
      ...project,
      sequences: project.sequences.map((seq) =>
        seq.id === sequence.id
          ? {
              ...seq,
              clips: seq.clips.map((clip) =>
                clip.id === ids[1] ? { ...clip, trackId: otherTrack } : clip,
              ),
            }
          : seq,
      ),
    };
    const added = run(moved, fx.addTransitionCommand(ids[0]!, ids[1]!));
    expect(activeSequence(added.project).transitions ?? []).toHaveLength(0);
  });

  it("replaces an existing transition on the same cut", () => {
    const { project, ids } = projectWithClips();
    let state = run(project, fx.addTransitionCommand(ids[0]!, ids[1]!, "crossDissolve"));
    state = run(state.project, fx.addTransitionCommand(ids[0]!, ids[1]!, "wipeLeft"));

    const transitions = activeSequence(state.project).transitions!;
    expect(transitions).toHaveLength(1);
    expect(transitions[0]!.type).toBe("wipeLeft");
  });

  it("removes a transition", () => {
    const { project, ids } = projectWithClips();
    const added = run(project, fx.addTransitionCommand(ids[0]!, ids[1]!));
    const id = activeSequence(added.project).transitions![0]!.id;
    const removed = run(added.project, fx.removeTransitionCommand(id));
    expect(activeSequence(removed.project).transitions).toHaveLength(0);
  });
});

describe("text clips", () => {
  it("adds a text clip with no source media", () => {
    const { project, trackId } = projectWithClips();
    const added = run(project, fx.addTextClipCommand(trackId, 20, 4, { content: "タイトル" }));
    const clip = activeSequence(added.project).clips.find((entry) => entry.kind === "text")!;
    expect(clip.mediaId).toBeNull();
    expect(clip.text!.content).toBe("タイトル");
    expect(engine.clipDuration(clip)).toBeCloseTo(4);
  });

  it("edits text content", () => {
    const { project, trackId } = projectWithClips();
    const added = run(project, fx.addTextClipCommand(trackId, 20));
    const id = activeSequence(added.project).clips.find((entry) => entry.kind === "text")!.id;

    const edited = run(added.project, fx.updateTextCommand(id, { content: "変更後" }));
    const clip = activeSequence(edited.project).clips.find((entry) => entry.id === id)!;
    expect(clip.text!.content).toBe("変更後");
    expect(clip.label).toBe("変更後");
  });
});

describe("keyframe commands", () => {
  it("adds a keyframe seeded from the current value", () => {
    const { project, ids } = projectWithClips();
    const added = run(project, fx.addKeyframeCommand(ids[0]!, "transform.opacity", 2));
    const clip = activeSequence(added.project).clips[0]!;
    expect(clip.keyframes![0]!.keyframes[0]).toMatchObject({ time: 2, value: 100 });
  });

  it("converts sequence time to clip-relative time", () => {
    const { project, ids } = projectWithClips();
    // clip_b starts at 5s, so a keyframe at 7s is 2s into the clip.
    const added = run(project, fx.addKeyframeCommand(ids[1]!, "transform.scale", 7, 50));
    const clip = activeSequence(added.project).clips.find((entry) => entry.id === ids[1])!;
    expect(clip.keyframes![0]!.keyframes[0]!.time).toBeCloseTo(2);
  });

  it("clears every keyframe on a property", () => {
    const { project, ids } = projectWithClips();
    let state = run(project, fx.addKeyframeCommand(ids[0]!, "transform.scale", 1, 10));
    state = run(state.project, fx.addKeyframeCommand(ids[0]!, "transform.scale", 3, 90));

    const cleared = run(state.project, fx.clearKeyframesCommand(ids[0]!, "transform.scale"));
    expect(activeSequence(cleared.project).clips[0]!.keyframes).toHaveLength(0);
  });
});

describe("multicam", () => {
  it("switches to another angle at the playhead", () => {
    const { project, ids } = projectWithClips();
    const withGroup: Project = {
      ...project,
      multicamGroups: [
        {
          id: "g1",
          name: "インタビュー",
          syncMethod: "audio",
          angles: [
            { mediaId: "m1", name: "カメラ1", offset: 0 },
            { mediaId: "m2", name: "カメラ2", offset: 0.5 },
          ],
        },
      ],
    };

    const switched = run(withGroup, fx.switchAngleCommand(ids[0]!, 2, 1));
    const clips = activeSequence(switched.project).clips;
    // The clip is split and the later half shows the new angle.
    const second = clips.find((clip) => clip.multicam?.angleIndex === 1);
    expect(second).toBeDefined();
    expect(second!.mediaId).toBe("m2");
    expect(second!.startTime).toBeCloseTo(2);
  });

  it("does nothing when the angle does not exist", () => {
    const { project, ids } = projectWithClips();
    const switched = run(project, fx.switchAngleCommand(ids[0]!, 2, 5));
    expect(activeSequence(switched.project).clips).toHaveLength(2);
  });
});
