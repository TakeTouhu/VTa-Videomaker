import { describe, expect, it } from "vitest";
import * as commands from "./commands";
import * as engine from "./engine";
import * as history from "@/features/history/historyManager";
import { activeSequence, createProject } from "@/features/project/factory";
import type { Project } from "@/types/project";
import type { Clip } from "@/types/timeline";

function projectWithClip(): { project: Project; clip: Clip } {
  const base = createProject("Test");
  const sequence = activeSequence(base);
  const track = sequence.videoTracks[0]!;
  const clip = engine.createClip({
    mediaId: "m1",
    trackId: track.id,
    startTime: 0,
    sourceIn: 0,
    sourceOut: 10,
    id: "clip_a",
  });
  return {
    project: {
      ...base,
      sequences: base.sequences.map((seq) =>
        seq.id === sequence.id ? { ...seq, clips: [clip] } : seq,
      ),
    },
    clip,
  };
}

function run(project: Project, command: ReturnType<typeof commands.deleteClipsCommand>) {
  return history.execute(project, history.emptyHistory(), command);
}

describe("timeline commands", () => {
  it("every edit is undoable back to the exact previous state", () => {
    const { project, clip } = projectWithClip();
    const cases = [
      commands.moveClipCommand(clip.id, 5),
      commands.trimClipCommand(clip.id, "end", 4),
      commands.splitClipCommand(clip.id, 5),
      commands.deleteClipsCommand([clip.id]),
      commands.rippleDeleteCommand([clip.id]),
      commands.duplicateClipsCommand([clip.id]),
      commands.changeColorCommand(clip.id, { exposure: 20 }),
      commands.changeSpeedCommand(clip.id, 2),
      commands.changeAudioCommand(clip.id, { volume: -6 }),
      commands.changeTransformCommand(clip.id, { scale: 50 }),
    ];

    for (const command of cases) {
      const executed = run(project, command);
      const undone = history.undo(executed.project, executed.history);
      expect(undone.project, command.label).toEqual(project);
    }
  });

  it("delete removes the clip", () => {
    const { project, clip } = projectWithClip();
    const result = run(project, commands.deleteClipsCommand([clip.id]));
    expect(activeSequence(result.project).clips).toHaveLength(0);
  });

  it("split produces two clips", () => {
    const { project, clip } = projectWithClip();
    const result = run(project, commands.splitClipCommand(clip.id, 4));
    expect(activeSequence(result.project).clips).toHaveLength(2);
  });

  it("a batch of edits is a single undo step", () => {
    const { project, clip } = projectWithClip();
    const batch = commands.batchCommand("AI: test", [
      commands.changeColorCommand(clip.id, { exposure: 10 }),
      commands.changeSpeedCommand(clip.id, 2),
      commands.moveClipCommand(clip.id, 3),
    ]);

    const executed = run(project, batch);
    expect(executed.history.undoStack).toHaveLength(1);

    const moved = activeSequence(executed.project).clips[0]!;
    expect(moved.startTime).toBe(3);
    expect(moved.speed).toBe(2);

    const undone = history.undo(executed.project, executed.history);
    expect(undone.project).toEqual(project);
  });
});
