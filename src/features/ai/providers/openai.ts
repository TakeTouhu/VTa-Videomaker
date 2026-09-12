/** Hosted provider: OpenAI-compatible chat completions + Whisper transcription.
 *
 * The endpoint is configurable, so any OpenAI-compatible server (including a
 * local one) works without code changes. The response is returned as `unknown`
 * and validated by the schema layer before it can reach the timeline.
 */

import type { AIProvider, PlanRequest } from "../provider";
import type { AIProviderConfig, TranscriptSegment } from "@/types/ai";
import { EDIT_PLAN_JSON_SCHEMA, SYSTEM_PROMPT, buildUserPrompt } from "../prompt";

export const DEFAULT_ENDPOINT = "https://api.openai.com/v1";
export const DEFAULT_MODEL = "gpt-4o";
export const DEFAULT_TRANSCRIBE_MODEL = "whisper-1";

/** Requests are given a generous but finite budget; editing must not hang. */
export const REQUEST_TIMEOUT_MS = 120_000;

interface ChatResponse {
  choices?: { message?: { content?: string } }[];
  error?: { message?: string };
}

export interface WhisperResponse {
  segments?: { start: number; end: number; text: string }[];
  text?: string;
  error?: { message?: string };
}

async function postJson(url: string, apiKey: string, body: unknown): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const payload = (await response.json()) as { error?: { message?: string } };
    if (!response.ok) {
      throw new Error(
        payload.error?.message ?? `リクエストが失敗しました (HTTP ${response.status})`,
      );
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

export function createOpenAIProvider(config: AIProviderConfig): AIProvider {
  const endpoint = config.endpoint ?? DEFAULT_ENDPOINT;
  const model = config.model ?? DEFAULT_MODEL;

  const requireKey = (): string => {
    if (!config.apiKey) {
      throw new Error("APIキーが設定されていません。設定画面で登録してください。");
    }
    return config.apiKey;
  };

  return {
    id: "openai",

    async createEditPlan(request: PlanRequest): Promise<unknown> {
      const response = (await postJson(`${endpoint}/chat/completions`, requireKey(), {
        model,
        // Deterministic output: the same timeline and prompt should not produce
        // a different cut each time it is asked.
        temperature: 0,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: buildUserPrompt(request.prompt, {
              sequence: request.sequence,
              analyses: request.analyses,
              mediaNames: request.mediaNames ?? {},
            }),
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "edit_plan",
            strict: false,
            schema: EDIT_PLAN_JSON_SCHEMA,
          },
        },
      })) as ChatResponse;

      const content = response.choices?.[0]?.message?.content;
      if (!content) throw new Error("AIが空の応答を返しました");
      // Returned as text on purpose: parseEditPlan owns JSON handling.
      return content;
    },

    async transcribe(audioPath: string): Promise<TranscriptSegment[]> {
      const file = await readAudioFile(audioPath);
      const form = new FormData();
      form.append("file", file, "audio.wav");
      form.append("model", config.model ?? DEFAULT_TRANSCRIBE_MODEL);
      form.append("response_format", "verbose_json");
      form.append("timestamp_granularities[]", "segment");

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const response = await fetch(`${endpoint}/audio/transcriptions`, {
          method: "POST",
          headers: { Authorization: `Bearer ${requireKey()}` },
          body: form,
          signal: controller.signal,
        });
        const payload = (await response.json()) as WhisperResponse;
        if (!response.ok) {
          throw new Error(payload.error?.message ?? "音声認識に失敗しました");
        }
        return normaliseWhisperSegments(payload);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/** Maps a Whisper response onto the transcript shape used everywhere else. */
export function normaliseWhisperSegments(payload: WhisperResponse): TranscriptSegment[] {
  if (payload.segments && payload.segments.length > 0) {
    return payload.segments
      .filter((segment) => segment.end > segment.start && segment.text.trim().length > 0)
      .map((segment) => ({
        start: segment.start,
        end: segment.end,
        text: segment.text.trim(),
      }));
  }
  // A response without segment timings is not usable for cutting, so it is
  // reported as empty rather than as one giant segment.
  return [];
}

/** Reads the extracted WAV so it can be posted as multipart form data. */
async function readAudioFile(path: string): Promise<Blob> {
  const { readFile } = await import("@tauri-apps/plugin-fs");
  const bytes = await readFile(path);
  return new Blob([bytes], { type: "audio/wav" });
}
