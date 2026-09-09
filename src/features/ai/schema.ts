/** JSON-schema level validation of AI output (design doc sections 25, 51).
 *
 * Step 1 of the pipeline:
 *   AI Output -> Schema Validation -> Business Rule Validation -> Command -> Execute
 */

import { z } from "zod";
import { COLOR_RANGES } from "@/types/color";
import type { EditPlan } from "@/types/ai";

const finiteTime = z
  .number()
  .finite()
  .nonnegative()
  .max(24 * 60 * 60, "時間の値が長すぎます");

const clipId = z.string().min(1).max(128);
const reason = z.string().max(500).optional();

const cutAction = z.object({
  type: z.literal("cut"),
  clipId,
  at: finiteTime,
  reason,
});

const deleteAction = z.object({
  type: z.literal("delete"),
  clipId,
  start: finiteTime,
  end: finiteTime,
  ripple: z.boolean().default(true),
  reason,
});

const moveAction = z.object({
  type: z.literal("move"),
  clipId,
  startTime: finiteTime,
  trackId: z.string().min(1).max(128).optional(),
  reason,
});

const colorPatch = z
  .object(
    Object.fromEntries(
      Object.entries(COLOR_RANGES).map(([key, [min, max]]) => [
        key,
        z.number().finite().min(min).max(max).optional(),
      ]),
    ) as Record<keyof typeof COLOR_RANGES, z.ZodOptional<z.ZodNumber>>,
  )
  .refine((patch) => Object.keys(patch).length > 0, {
    message: "color アクションに変更するパラメータがありません",
  });

const colorAction = z.object({
  type: z.literal("color"),
  clipId,
  color: colorPatch,
  reason,
});

const volumeAction = z.object({
  type: z.literal("volume"),
  clipId,
  volume: z.number().finite().min(-60).max(12),
  reason,
});

const speedAction = z.object({
  type: z.literal("speed"),
  clipId,
  speed: z.number().finite().min(0.1).max(10),
  reason,
});

export const editActionSchema = z.discriminatedUnion("type", [
  cutAction,
  deleteAction,
  moveAction,
  colorAction,
  volumeAction,
  speedAction,
]);

/** Hard cap: a single plan may not rewrite an unbounded number of clips. */
export const MAX_ACTIONS_PER_PLAN = 500;

export const editPlanSchema = z.object({
  id: z.string().min(1),
  prompt: z.string().max(4000),
  summary: z.string().min(1).max(1000),
  actions: z.array(editActionSchema).min(1).max(MAX_ACTIONS_PER_PLAN),
  createdAt: z.string().min(1),
});

export type SchemaCheck =
  | { ok: true; plan: EditPlan }
  | { ok: false; issues: string[] };

/** Parses raw model output. Accepts an object or a JSON string. */
export function parseEditPlan(raw: unknown): SchemaCheck {
  let candidate = raw;
  if (typeof raw === "string") {
    try {
      candidate = JSON.parse(raw);
    } catch {
      return { ok: false, issues: ["AIの応答がJSONとして解釈できません"] };
    }
  }
  const result = editPlanSchema.safeParse(candidate);
  if (!result.success) {
    return {
      ok: false,
      issues: result.error.issues.map(
        (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`,
      ),
    };
  }
  return { ok: true, plan: result.data as EditPlan };
}
