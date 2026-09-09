/** Step 3 of the AI pipeline: validated actions -> undoable editor commands.
 *
 * Ranges are applied from the end of the timeline backwards so that ripple
 * deletes earlier in the plan do not invalidate the times of later ones.
 */

import type { AIEditAction, EditPlan } from "@/types/ai";
import type { Sequence } from "@/types/timeline";
import type { EditorCommand } from "@/features/history/command";
import * as commands from "@/features/timeline/commands";
import * as engine from "@/features/timeline/engine";
import { mergeDeleteRanges, validatePlan } from "./validation";
import type { ValidationIssue } from "./validation";

export interface LoweredPlan {
  command: EditorCommand | null;
  appliedActions: AIEditAction[];
  rejected: ValidationIssue[];
}

function actionToCommand(
  action: AIEditAction,
  sequence: Sequence,
): EditorCommand | null {
  const clip = engine.findClip(sequence, action.clipId);
  if (!clip) return null;

  switch (action.type) {
    case "cut":
      return commands.splitClipCommand(action.clipId, action.at);
    case "delete":
      return commands.removeRangeCommand(
        clip.trackId,
        Math.max(action.start, clip.startTime),
        Math.min(action.end, engine.clipEnd(clip)),
        action.ripple,
        "AI Delete",
      );
    case "move":
      return commands.moveClipCommand(action.clipId, action.startTime, action.trackId);
    case "color":
      return commands.changeColorCommand(action.clipId, action.color);
    case "volume":
      return commands.changeAudioCommand(action.clipId, { volume: action.volume });
    case "speed":
      return commands.changeSpeedCommand(action.clipId, action.speed);
  }
}

/**
 * Validates a plan and lowers it into one batched command, so the whole AI edit
 * is a single undo step (design doc section 32).
 */
export function lowerPlan(plan: EditPlan, sequence: Sequence): LoweredPlan {
  const { accepted, rejected } = validatePlan(plan, sequence);
  if (accepted.length === 0) {
    return { command: null, appliedActions: [], rejected };
  }

  const normalized = mergeDeleteRanges(accepted);

  // Time-affecting actions run back to front; parameter-only actions are
  // order-independent and stay in plan order.
  const timeAffecting = normalized.filter(
    (action) => action.type === "delete" || action.type === "cut",
  );
  const parameterOnly = normalized.filter(
    (action) => action.type !== "delete" && action.type !== "cut",
  );

  timeAffecting.sort((a, b) => rangeStart(b) - rangeStart(a));

  const ordered = [...timeAffecting, ...parameterOnly];
  const lowered = ordered
    .map((action) => actionToCommand(action, sequence))
    .filter((command): command is EditorCommand => command !== null);

  if (lowered.length === 0) {
    return { command: null, appliedActions: [], rejected };
  }

  return {
    command: commands.batchCommand(planLabel(plan), lowered),
    appliedActions: ordered,
    rejected,
  };
}

function rangeStart(action: AIEditAction): number {
  if (action.type === "delete") return action.start;
  if (action.type === "cut") return action.at;
  return 0;
}

function planLabel(plan: EditPlan): string {
  return `AI: ${plan.summary.slice(0, 60)}`;
}
