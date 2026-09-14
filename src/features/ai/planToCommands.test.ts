import { describe, expect, it } from "vitest";
import { lowerPlan } from "./planToCommands";
import * as history from "@/features/history/historyManager";
import * as engine from "@/features/timeline/engine";
import { activeSequence, createProject } from "@/features/project/factory";
import type { Project } from "@/types/project";
import type { AIEditAction, EditPlan } from "@/types/ai";

/** Project with one 30s clip on V1, mirroring "one long take" imports. */
function projectWithTake(): { project: Project; clipId: string; trackId: string } {
  const base = createProject("AI test");
  const sequence = activeSequence(base);
  const trackId = sequence.videoTracks[0]!.id;
  const clip = engine.createClip({
    mediaId: "m1",
    trackId,
    startTime: 0,
    sourceIn: 0,
    sourceOut: 30,
    id: "clip_a",
  });
  return {
    project: {
      ...base,
      sequences: base.sequences.map((seq) =>
        seq.id === sequence.id ? { ...seq, clips: [clip] } : seq,
      ),
    },
    clipId: clip.id,
    trackId,
  };
}

function planWith(actions: AIEditAction[]): EditPlan {
  return {
    id: "plan_1",
    prompt: "無音を削除して",
    summary: "無音を削除します",
    actions,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("lowering an edit plan into commands", () => {
  it("applies a single ripple delete and closes the gap", () => {
    const { project, clipId } = projectWithTake();
    const lowered = lowerPlan(
      planWith([{ type: "delete", clipId, start: 5, end: 8, ripple: true }]),
      activeSequence(project),
    );

    expect(lowered.command).not.toBeNull();
    const result = history.execute(project, history.emptyHistory(), lowered.command!);
    expect(engine.sequenceDuration(activeSequence(result.project))).toBeCloseTo(27);
  });

  it("applies several deletes without the earlier ones invalidating the later ones", () => {
    const { project, clipId } = projectWithTake();
    const lowered = lowerPlan(
      planWith([
        { type: "delete", clipId, start: 2, end: 4, ripple: true },
        { type: "delete", clipId, start: 10, end: 13, ripple: true },
        { type: "delete", clipId, start: 20, end: 25, ripple: true },
      ]),
      activeSequence(project),
    );

    const result = history.execute(project, history.emptyHistory(), lowered.command!);
    const sequence = activeSequence(result.project);

    // 2 + 3 + 5 = 10 seconds removed from a 30 second take.
    expect(engine.sequenceDuration(sequence)).toBeCloseTo(20);
    // No gaps: every clip starts where the previous one ended.
    const clips = engine.clipsOnTrack(sequence, sequence.videoTracks[0]!.id);
    clips.forEach((clip, index) => {
      if (index === 0) return;
      expect(clip.startTime).toBeCloseTo(engine.clipEnd(clips[index - 1]!));
    });
  });

  it("is a single undo step for the whole plan", () => {
    const { project, clipId } = projectWithTake();
    const lowered = lowerPlan(
      planWith([
        { type: "delete", clipId, start: 2, end: 4, ripple: true },
        { type: "delete", clipId, start: 10, end: 13, ripple: true },
      ]),
      activeSequence(project),
    );

    const executed = history.execute(project, history.emptyHistory(), lowered.command!);
    expect(executed.history.undoStack).toHaveLength(1);

    const undone = history.undo(executed.project, executed.history);
    expect(undone.project).toEqual(project);
  });

  it("drops invalid actions and still applies the valid ones", () => {
    const { project, clipId } = projectWithTake();
    const lowered = lowerPlan(
      planWith([
        { type: "delete", clipId, start: 5, end: 8, ripple: true },
        { type: "delete", clipId: "ghost", start: 1, end: 2, ripple: true },
      ]),
      activeSequence(project),
    );

    expect(lowered.rejected).toHaveLength(1);
    const result = history.execute(project, history.emptyHistory(), lowered.command!);
    expect(engine.sequenceDuration(activeSequence(result.project))).toBeCloseTo(27);
  });

  it("produces no command when every action is invalid", () => {
    const { project } = projectWithTake();
    const lowered = lowerPlan(
      planWith([{ type: "delete", clipId: "ghost", start: 1, end: 2, ripple: true }]),
      activeSequence(project),
    );
    expect(lowered.command).toBeNull();
    expect(lowered.rejected).toHaveLength(1);
  });

  it("applies colour parameters rather than touching pixels", () => {
    const { project, clipId } = projectWithTake();
    const lowered = lowerPlan(
      planWith([
        { type: "color", clipId, color: { temperature: -4, contrast: 12, saturation: 92 } },
      ]),
      activeSequence(project),
    );

    const result = history.execute(project, history.emptyHistory(), lowered.command!);
    const clip = activeSequence(result.project).clips[0]!;
    expect(clip.color).toMatchObject({ temperature: -4, contrast: 12, saturation: 92 });
    // Untouched parameters keep their defaults, so the grade stays editable.
    expect(clip.color.exposure).toBe(0);
  });

  it("clamps a delete range to the clip it names", () => {
    const { project, clipId } = projectWithTake();
    const lowered = lowerPlan(
      planWith([{ type: "delete", clipId, start: 25, end: 100, ripple: true }]),
      activeSequence(project),
    );
    const result = history.execute(project, history.emptyHistory(), lowered.command!);
    expect(engine.sequenceDuration(activeSequence(result.project))).toBeCloseTo(25);
  });
});
