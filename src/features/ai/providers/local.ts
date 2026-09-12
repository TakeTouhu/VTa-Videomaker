/** Local provider: transcription runs in the Rust core via a local engine, and
 *  editing requests are answered by the built-in deterministic planners.
 *
 * This keeps the app usable offline: no API key, no network. It covers the
 * fixed set of requests the built-in planners implement and says so plainly for
 * anything else, rather than guessing.
 */

import type { AIProvider, PlanRequest } from "../provider";
import type { TranscriptSegment } from "@/types/ai";
import { backend } from "@/services/backend";
import { buildSilenceCutPlan } from "../silenceCut";
import { buildCondensePlan, buildFillerCutPlan } from "../transcriptPlans";
import { matchIntent } from "../intent";

export const LOCAL_CAPABILITY_MESSAGE =
  "ローカルモードで対応しているのは「無音を削除」「言い直し・フィラーを削除」" +
  "「○分にまとめる」です。その他の指示にはAPIプロバイダの設定が必要です。";

export function createLocalProvider(): AIProvider {
  return {
    id: "local",

    async createEditPlan(request: PlanRequest): Promise<unknown> {
      const intent = matchIntent(request.prompt);

      switch (intent.kind) {
        case "silence":
          return buildSilenceCutPlan(request.sequence, request.analyses);
        case "filler":
          return buildFillerCutPlan(request.sequence, request.analyses);
        case "condense":
          return buildCondensePlan(
            request.sequence,
            request.analyses,
            intent.targetSeconds,
          );
        case "unknown":
          throw new Error(LOCAL_CAPABILITY_MESSAGE);
      }
    },

    async transcribe(audioPath: string): Promise<TranscriptSegment[]> {
      return backend().transcribeAudio(audioPath);
    },
  };
}
