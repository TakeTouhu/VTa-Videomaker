/** AI provider abstraction (design doc section 5).
 *
 *   AIProvider
 *    ├─ OpenAIProvider   (added in Phase 3)
 *    ├─ LocalProvider    (added in Phase 3)
 *    └─ MockProvider     (deterministic, used by the UI until then)
 *
 * The UI never talks to a model directly - it goes through this interface, so
 * swapping providers does not touch a single component.
 */

import type { AIProviderConfig, MediaAnalysis, TranscriptSegment } from "@/types/ai";
import type { Sequence } from "@/types/timeline";

export interface PlanRequest {
  prompt: string;
  sequence: Sequence;
  /** Analysis for every media item referenced by the sequence. */
  analyses: MediaAnalysis[];
  /** Human readable media names, so the model can reason about the footage. */
  mediaNames?: Record<string, string>;
}

export interface AIProvider {
  readonly id: string;
  /**
   * Turns a natural language request into a proposed edit plan. The return type
   * is deliberately `unknown`: model output is untrusted until it has passed
   * schema and business-rule validation (design doc section 51).
   */
  createEditPlan(request: PlanRequest): Promise<unknown>;
  /** Speech to text (design doc section 20). */
  transcribe?(audioPath: string): Promise<TranscriptSegment[]>;
}

/** Registry so the provider can be swapped at runtime from settings. */
const providers = new Map<string, AIProvider>();

export function registerProvider(provider: AIProvider): void {
  providers.set(provider.id, provider);
}

export function getProvider(config: AIProviderConfig): AIProvider {
  const provider = providers.get(config.provider);
  if (!provider) {
    throw new Error(`AI provider "${config.provider}" is not registered`);
  }
  return provider;
}

export function registeredProviderIds(): string[] {
  return [...providers.keys()];
}
