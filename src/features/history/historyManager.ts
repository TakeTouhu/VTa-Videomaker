/** Undo / redo stacks over EditorCommand (design doc section 32). */

import type { Project } from "@/types/project";
import type { EditorCommand } from "./command";

export interface HistoryEntry {
  command: EditorCommand;
  /** Wall clock time, shown in the history panel. */
  at: string;
}

export interface HistoryState {
  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];
}

export const MAX_HISTORY = 200;

export function emptyHistory(): HistoryState {
  return { undoStack: [], redoStack: [] };
}

export interface ExecuteResult {
  project: Project;
  history: HistoryState;
}

/**
 * Runs a command and pushes it onto the undo stack, clearing redo.
 * Commands sharing a mergeKey with the previous entry replace it, so that a
 * slider drag collapses into a single undo step.
 */
export function execute(
  project: Project,
  history: HistoryState,
  command: EditorCommand,
): ExecuteResult {
  const next = command.execute(project);
  const entry: HistoryEntry = { command, at: new Date().toISOString() };

  const previous = history.undoStack[history.undoStack.length - 1];
  const canMerge =
    command.mergeKey !== undefined && previous?.command.mergeKey === command.mergeKey;

  const undoStack = canMerge
    ? [
        ...history.undoStack.slice(0, -1),
        {
          ...entry,
          command: mergeCommands(previous.command, command),
        },
      ]
    : [...history.undoStack, entry];

  return {
    project: next,
    history: {
      undoStack: undoStack.slice(-MAX_HISTORY),
      redoStack: [],
    },
  };
}

/** Combines two coalesced commands into one that undoes back to the original. */
function mergeCommands(first: EditorCommand, second: EditorCommand): EditorCommand {
  return {
    label: second.label,
    mergeKey: second.mergeKey,
    execute: (project) => second.execute(first.execute(project)),
    undo: (project) => first.undo(second.undo(project)),
  };
}

export function undo(project: Project, history: HistoryState): ExecuteResult {
  const entry = history.undoStack[history.undoStack.length - 1];
  if (!entry) return { project, history };
  return {
    project: entry.command.undo(project),
    history: {
      undoStack: history.undoStack.slice(0, -1),
      redoStack: [...history.redoStack, entry],
    },
  };
}

export function redo(project: Project, history: HistoryState): ExecuteResult {
  const entry = history.redoStack[history.redoStack.length - 1];
  if (!entry) return { project, history };
  return {
    project: entry.command.execute(project),
    history: {
      undoStack: [...history.undoStack, entry],
      redoStack: history.redoStack.slice(0, -1),
    },
  };
}

export function canUndo(history: HistoryState): boolean {
  return history.undoStack.length > 0;
}

export function canRedo(history: HistoryState): boolean {
  return history.redoStack.length > 0;
}

export function undoLabel(history: HistoryState): string | undefined {
  return history.undoStack[history.undoStack.length - 1]?.command.label;
}

export function redoLabel(history: HistoryState): string | undefined {
  return history.redoStack[history.redoStack.length - 1]?.command.label;
}
