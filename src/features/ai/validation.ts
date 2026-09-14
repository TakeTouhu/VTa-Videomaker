/** Business-rule validation of an edit plan (design doc section 51).
 *
 * Step 2 of the pipeline. Schema validity is not enough: an action referring to
 * a clip that does not exist, a time outside the clip, or a locked track must
 * never reach the timeline engine.
 */

import type { AIEditAction, EditPlan } from "@/types/ai";
import type { Sequence } from "@/types/timeline";
import * as engine from "@/features/timeline/engine";
import { TIME_EPSILON } from "@/utils/time";

export interface ValidationIssue {
  actionIndex: number;
  code:
    | "unknown_clip"
    | "locked_track"
    | "time_outside_clip"
    | "invalid_range"
    | "unknown_track"
    | "no_effect";
  message: string;
}

export interface ValidationResult {
  /** Actions that passed every rule, in plan order. */
  accepted: AIEditAction[];
  /** Actions dropped, with the reason shown in the AI panel. */
  rejected: ValidationIssue[];
}

function issue(
  actionIndex: number,
  code: ValidationIssue["code"],
  message: string,
): ValidationIssue {
  return { actionIndex, code, message };
}

/** Validates each action against the current sequence. Never throws. */
export function validatePlan(plan: EditPlan, sequence: Sequence): ValidationResult {
  const accepted: AIEditAction[] = [];
  const rejected: ValidationIssue[] = [];

  plan.actions.forEach((action, index) => {
    const clip = engine.findClip(sequence, action.clipId);
    if (!clip) {
      rejected.push(
        issue(index, "unknown_clip", `存在しないクリップです: ${action.clipId}`),
      );
      return;
    }
    if (engine.isTrackLocked(sequence, clip.trackId)) {
      rejected.push(
        issue(index, "locked_track", "ロックされたトラックのクリップは変更できません"),
      );
      return;
    }

    const start = clip.startTime;
    const end = engine.clipEnd(clip);

    switch (action.type) {
      case "cut": {
        if (action.at <= start + TIME_EPSILON || action.at >= end - TIME_EPSILON) {
          rejected.push(
            issue(index, "time_outside_clip", "分割位置がクリップの範囲外です"),
          );
          return;
        }
        break;
      }
      case "delete": {
        if (action.end - action.start <= TIME_EPSILON) {
          rejected.push(issue(index, "invalid_range", "削除範囲の長さが0以下です"));
          return;
        }
        if (action.end <= start + TIME_EPSILON || action.start >= end - TIME_EPSILON) {
          rejected.push(
            issue(index, "time_outside_clip", "削除範囲がクリップと重なっていません"),
          );
          return;
        }
        break;
      }
      case "move": {
        if (action.trackId && !engine.findTrack(sequence, action.trackId)) {
          rejected.push(
            issue(index, "unknown_track", `存在しないトラックです: ${action.trackId}`),
          );
          return;
        }
        if (
          Math.abs(action.startTime - start) <= TIME_EPSILON &&
          (!action.trackId || action.trackId === clip.trackId)
        ) {
          rejected.push(issue(index, "no_effect", "移動先が現在位置と同じです"));
          return;
        }
        break;
      }
      case "speed": {
        if (Math.abs(action.speed - clip.speed) <= TIME_EPSILON) {
          rejected.push(issue(index, "no_effect", "速度が現在値と同じです"));
          return;
        }
        break;
      }
      case "color":
      case "volume":
        break;
    }

    accepted.push(action);
  });

  return { accepted, rejected };
}

/** Overlapping delete ranges on the same clip are collapsed before applying. */
export function mergeDeleteRanges(actions: AIEditAction[]): AIEditAction[] {
  const deletes = actions.filter(
    (action): action is Extract<AIEditAction, { type: "delete" }> =>
      action.type === "delete",
  );
  const rest = actions.filter((action) => action.type !== "delete");
  if (deletes.length <= 1) return actions;

  const byClip = new Map<string, Extract<AIEditAction, { type: "delete" }>[]>();
  for (const action of deletes) {
    const list = byClip.get(action.clipId) ?? [];
    list.push(action);
    byClip.set(action.clipId, list);
  }

  const merged: AIEditAction[] = [];
  for (const [, list] of byClip) {
    const sorted = [...list].sort((a, b) => a.start - b.start);
    let current = { ...sorted[0]! };
    for (const action of sorted.slice(1)) {
      if (action.start <= current.end + TIME_EPSILON) {
        current.end = Math.max(current.end, action.end);
      } else {
        merged.push(current);
        current = { ...action };
      }
    }
    merged.push(current);
  }
  return [...rest, ...merged];
}
