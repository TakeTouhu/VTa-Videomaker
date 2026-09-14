/** Command pattern primitives (design doc section 32).
 *
 * Every edit - manual or produced by an AI edit plan - is a Command, so
 * Ctrl+Z behaves identically no matter who made the change.
 */

import type { Project } from "@/types/project";

export interface EditorCommand {
  /** Shown in the history / status bar, e.g. "Split Clip". */
  label: string;
  /** Returns the project state after the edit. Must be pure. */
  execute(project: Project): Project;
  /** Returns the project state before the edit. Must be pure. */
  undo(project: Project): Project;
  /**
   * Optional coalescing: consecutive commands of the same kind (dragging a
   * slider) merge into one undo step.
   */
  mergeKey?: string;
}

export interface CommandOptions {
  label: string;
  mergeKey?: string;
}

/**
 * Builds a command from a forward transform by snapshotting the state the
 * transform touched. Snapshots are structurally shared - only the sequence and
 * media arrays are copied - so this stays cheap for large projects.
 */
export function snapshotCommand(
  options: CommandOptions,
  transform: (project: Project) => Project,
): EditorCommand {
  let before: Project | null = null;
  return {
    label: options.label,
    mergeKey: options.mergeKey,
    execute(project) {
      before = project;
      return transform(project);
    },
    undo() {
      if (!before) {
        throw new Error(`Cannot undo "${options.label}" before it was executed`);
      }
      return before;
    },
  };
}
