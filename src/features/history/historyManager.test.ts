import { describe, expect, it } from "vitest";
import * as history from "./historyManager";
import { snapshotCommand } from "./command";
import type { Project } from "@/types/project";
import { createProject } from "@/features/project/factory";

function rename(name: string) {
  return snapshotCommand({ label: `Rename ${name}` }, (project) => ({ ...project, name }));
}

function setName(name: string, mergeKey: string) {
  return snapshotCommand({ label: "Rename", mergeKey }, (project) => ({ ...project, name }));
}

describe("history manager", () => {
  const base: Project = createProject("Original");

  it("executes a command and records it", () => {
    const result = history.execute(base, history.emptyHistory(), rename("A"));
    expect(result.project.name).toBe("A");
    expect(history.canUndo(result.history)).toBe(true);
    expect(history.canRedo(result.history)).toBe(false);
  });

  it("undoes back to the previous state", () => {
    const executed = history.execute(base, history.emptyHistory(), rename("A"));
    const undone = history.undo(executed.project, executed.history);
    expect(undone.project.name).toBe("Original");
    expect(history.canRedo(undone.history)).toBe(true);
  });

  it("redoes an undone command", () => {
    const executed = history.execute(base, history.emptyHistory(), rename("A"));
    const undone = history.undo(executed.project, executed.history);
    const redone = history.redo(undone.project, undone.history);
    expect(redone.project.name).toBe("A");
    expect(history.canRedo(redone.history)).toBe(false);
  });

  it("round-trips a stack of commands", () => {
    let state = history.execute(base, history.emptyHistory(), rename("A"));
    state = history.execute(state.project, state.history, rename("B"));
    state = history.execute(state.project, state.history, rename("C"));

    state = history.undo(state.project, state.history);
    state = history.undo(state.project, state.history);
    expect(state.project.name).toBe("A");

    state = history.undo(state.project, state.history);
    expect(state.project.name).toBe("Original");
    expect(history.canUndo(state.history)).toBe(false);
  });

  it("clears the redo stack when a new command is executed", () => {
    let state = history.execute(base, history.emptyHistory(), rename("A"));
    state = history.undo(state.project, state.history);
    state = history.execute(state.project, state.history, rename("B"));
    expect(history.canRedo(state.history)).toBe(false);
  });

  it("coalesces commands that share a merge key into one undo step", () => {
    let state = history.execute(base, history.emptyHistory(), setName("A", "name"));
    state = history.execute(state.project, state.history, setName("B", "name"));
    state = history.execute(state.project, state.history, setName("C", "name"));

    expect(state.project.name).toBe("C");
    expect(state.history.undoStack).toHaveLength(1);

    state = history.undo(state.project, state.history);
    expect(state.project.name).toBe("Original");
  });

  it("does not coalesce commands with different merge keys", () => {
    let state = history.execute(base, history.emptyHistory(), setName("A", "one"));
    state = history.execute(state.project, state.history, setName("B", "two"));
    expect(state.history.undoStack).toHaveLength(2);
  });

  it("is a no-op when there is nothing to undo or redo", () => {
    const empty = history.emptyHistory();
    expect(history.undo(base, empty).project).toBe(base);
    expect(history.redo(base, empty).project).toBe(base);
  });

  it("caps the undo stack", () => {
    let state = { project: base, history: history.emptyHistory() };
    for (let index = 0; index < history.MAX_HISTORY + 20; index += 1) {
      state = history.execute(state.project, state.history, rename(`n${index}`));
    }
    expect(state.history.undoStack).toHaveLength(history.MAX_HISTORY);
  });

  it("reports the label of the next undo", () => {
    const state = history.execute(base, history.emptyHistory(), rename("A"));
    expect(history.undoLabel(state.history)).toBe("Rename A");
  });
});
