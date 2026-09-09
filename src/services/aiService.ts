/** AI orchestration: request -> validate -> propose -> apply.
 *
 * Components call these functions; they never touch a provider or the timeline
 * engine directly (design rules 6 and 10).
 */

import { useAIStore } from "@/store/aiStore";
import { useEditorStore } from "@/store/editorStore";
import { useUIStore } from "@/store/uiStore";
import { backend } from "./backend";
import { parseEditPlan } from "@/features/ai/schema";
import { validatePlan } from "@/features/ai/validation";
import { lowerPlan } from "@/features/ai/planToCommands";
import { buildSilenceCutPlan } from "@/features/ai/silenceCut";
import { appError, userMessage } from "@/types/errors";
import { createId } from "@/utils/id";
import type { EditPlan } from "@/types/ai";

/** Runs analysis for every media item used by the active sequence. */
export async function analyzeSequenceMedia(): Promise<void> {
  const editor = useEditorStore.getState();
  const ai = useAIStore.getState();
  const mediaIds = [
    ...new Set(
      editor
        .sequence()
        .clips.map((clip) => clip.mediaId)
        .filter((id): id is string => id !== null),
    ),
  ];

  for (const mediaId of mediaIds) {
    if (ai.analyses[mediaId]) continue;
    try {
      editor.updateMedia(mediaId, { analysisState: "running" });
      const analysis = await backend().analyzeMedia(mediaId);
      useAIStore.getState().setAnalysis(analysis);
      editor.updateMedia(mediaId, { analysisState: "completed" });
    } catch (error) {
      editor.updateMedia(mediaId, { analysisState: "failed" });
      useUIStore
        .getState()
        .pushError(appError("ai_request_failed", "素材の解析に失敗しました", String(error)));
    }
  }
}

/** Proposes the AI Silence Cut plan (design doc section 70). */
export async function proposeSilenceCut(): Promise<void> {
  const ai = useAIStore.getState();
  ai.setBusy(true);
  try {
    await analyzeSequenceMedia();
    const sequence = useEditorStore.getState().sequence();
    const analyses = Object.values(useAIStore.getState().analyses);
    const plan = buildSilenceCutPlan(sequence, analyses);
    proposePlan(plan);
  } finally {
    useAIStore.getState().setBusy(false);
  }
}

/**
 * Validates a plan produced anywhere (provider or built-in) and stages it for
 * the user's Apply / Reject decision.
 */
export function proposePlan(raw: unknown): EditPlan | null {
  const ai = useAIStore.getState();
  const parsed = parseEditPlan(raw);

  if (!parsed.ok) {
    useUIStore
      .getState()
      .pushError(
        appError("ai_response_invalid", userMessage("ai_response_invalid"), parsed.issues.join("\n")),
      );
    ai.addMessage("assistant", "編集案を作成できませんでした。もう一度お試しください。");
    return null;
  }

  const sequence = useEditorStore.getState().sequence();
  const { rejected } = validatePlan(parsed.plan, sequence);
  ai.setPendingPlan(parsed.plan, rejected);
  ai.addMessage("assistant", parsed.plan.summary, parsed.plan.id);
  return parsed.plan;
}

/** Applies the staged plan as a single undoable command (section 32). */
export function applyPendingPlan(): void {
  const ai = useAIStore.getState();
  const plan = ai.pendingPlan;
  if (!plan) return;

  const editor = useEditorStore.getState();
  const lowered = lowerPlan(plan, editor.sequence());

  if (!lowered.command) {
    useUIStore
      .getState()
      .pushError(appError("ai_response_invalid", "適用できる編集がありませんでした"));
    ai.setPendingPlan(null);
    return;
  }

  editor.dispatch(lowered.command);
  ai.recordApplied({
    id: createId("aihist"),
    planId: plan.id,
    summary: plan.summary,
    appliedAt: new Date().toISOString(),
    commandLabel: lowered.command.label,
  });
  ai.setPendingPlan(null);
  useUIStore.getState().setStatus(`AI編集を適用しました（Ctrl+Zで取り消せます）`);
}

export function rejectPendingPlan(): void {
  const ai = useAIStore.getState();
  ai.setPendingPlan(null);
  ai.addMessage("assistant", "編集案を破棄しました。");
}
