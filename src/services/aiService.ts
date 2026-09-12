/** AI orchestration: request -> provider -> validate -> propose -> apply.
 *
 * Components call these functions; they never touch a provider or the timeline
 * engine directly (design rules 6 and 10).
 */

import { useAIStore } from "@/store/aiStore";
import { useEditorStore } from "@/store/editorStore";
import { useUIStore } from "@/store/uiStore";
import { useSettingsStore } from "@/store/settingsStore";
import { backend, isTauri } from "./backend";
import { resolveApiKey } from "./settingsService";
import { parseEditPlan } from "@/features/ai/schema";
import { validatePlan } from "@/features/ai/validation";
import { lowerPlan } from "@/features/ai/planToCommands";
import { buildSilenceCutPlan } from "@/features/ai/silenceCut";
import { buildCondensePlan, buildFillerCutPlan } from "@/features/ai/transcriptPlans";
import { matchIntent } from "@/features/ai/intent";
import { getProvider } from "@/features/ai/provider";
import { createOpenAIProvider } from "@/features/ai/providers/openai";
import { appError, userMessage } from "@/types/errors";
import { createId } from "@/utils/id";
import type { EditPlan, MediaAnalysis } from "@/types/ai";

/** Media ids used by the active sequence. */
function sequenceMediaIds(): string[] {
  return [
    ...new Set(
      useEditorStore
        .getState()
        .sequence()
        .clips.map((clip) => clip.mediaId)
        .filter((id): id is string => id !== null),
    ),
  ];
}

export interface AnalyzeOptions {
  /** Run speech to text as well as silence and scene detection. */
  transcribe?: boolean;
  /** Re-analyse media that already has a result. */
  force?: boolean;
}

/**
 * Runs the analysis pipeline for every media item on the timeline
 * (design doc section 46).
 */
export async function analyzeSequenceMedia(options: AnalyzeOptions = {}): Promise<void> {
  const editor = useEditorStore.getState();
  const ui = useUIStore.getState();

  for (const mediaId of sequenceMediaIds()) {
    if (!options.force && useAIStore.getState().analyses[mediaId]) continue;

    try {
      editor.updateMedia(mediaId, { analysisState: "running" });
      const analysis = await backend().analyzeMedia(mediaId, { scenes: true });

      const withSpeech =
        options.transcribe && analysis.transcript.length === 0
          ? { ...analysis, transcript: await transcribeMedia(mediaId) }
          : analysis;

      useAIStore.getState().setAnalysis(withSpeech);
      editor.updateMedia(mediaId, { analysisState: "completed" });
    } catch (error) {
      editor.updateMedia(mediaId, { analysisState: "failed" });
      ui.pushError(
        appError("ai_request_failed", "素材の解析に失敗しました", String(error)),
      );
    }
  }
}

/**
 * Speech to text for one media item (design doc section 20):
 * extract audio -> transcribe with the configured provider -> cache.
 */
export async function transcribeMedia(mediaId: string) {
  const audioPath = await backend().extractAudio(mediaId);
  const provider = await currentProvider();

  if (!provider.transcribe) {
    throw new Error("選択中のAIプロバイダは音声認識に対応していません");
  }
  const segments = await provider.transcribe(audioPath);
  await backend().saveTranscript(mediaId, segments);
  return segments;
}

/** The provider selected in settings, with the real API key attached. */
async function currentProvider() {
  const config = useSettingsStore.getState().providerConfig();
  if (config.provider === "openai") {
    // The stored key is masked in the UI, so it is fetched on demand.
    const apiKey = (await resolveApiKey()) ?? config.apiKey;
    return createOpenAIProvider({ ...config, apiKey });
  }
  return getProvider(config);
}

/**
 * Handles a natural language request (design doc section 24).
 *
 * A request the built-in planners cover is answered deterministically; anything
 * else goes to the configured provider.
 */
export async function requestEdit(prompt: string): Promise<void> {
  const ai = useAIStore.getState();
  ai.setBusy(true);

  try {
    const intent = matchIntent(prompt);
    const needsTranscript = intent.kind === "filler" || intent.kind === "condense";

    await analyzeSequenceMedia({ transcribe: needsTranscript });

    const sequence = useEditorStore.getState().sequence();
    const analyses = Object.values(useAIStore.getState().analyses);

    if (needsTranscript && analyses.every((a) => a.transcript.length === 0)) {
      ai.addMessage(
        "assistant",
        "文字起こしが取得できませんでした。設定で音声認識エンジンかAPIプロバイダを指定してください。",
      );
      return;
    }

    // Built-in planners: deterministic, offline, and reproducible.
    if (intent.kind === "silence") {
      proposePlan(buildSilenceCutPlan(sequence, analyses));
      return;
    }
    if (intent.kind === "filler") {
      proposePlan(buildFillerCutPlan(sequence, analyses));
      return;
    }
    if (intent.kind === "condense") {
      proposePlan(buildCondensePlan(sequence, analyses, intent.targetSeconds));
      return;
    }

    // Anything else needs a model.
    const provider = await currentProvider();
    const raw = await provider.createEditPlan({
      prompt,
      sequence,
      analyses,
      mediaNames: Object.fromEntries(
        useEditorStore.getState().project.media.map((item) => [item.id, item.name]),
      ),
    });
    proposePlan(raw);
  } catch (error) {
    useAIStore
      .getState()
      .addMessage("assistant", errorText(error));
  } finally {
    useAIStore.getState().setBusy(false);
  }
}

function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (!isTauri() && /デスクトップ版/.test(message)) {
    return `${message}\n（ブラウザプレビューでは音声解析を実行できません）`;
  }
  return message;
}

/** Convenience entry point for the "無音を削除" shortcut button. */
export async function proposeSilenceCut(): Promise<void> {
  await requestEdit("無音部分を削除して");
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
        appError(
          "ai_response_invalid",
          userMessage("ai_response_invalid"),
          parsed.issues.join("\n"),
        ),
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
  useUIStore.getState().setStatus("AI編集を適用しました（Ctrl+Zで取り消せます）");
}

export function rejectPendingPlan(): void {
  const ai = useAIStore.getState();
  ai.setPendingPlan(null);
  ai.addMessage("assistant", "編集案を破棄しました。");
}

/** Re-exported so the transcript panel can show analysis state. */
export type { MediaAnalysis };
