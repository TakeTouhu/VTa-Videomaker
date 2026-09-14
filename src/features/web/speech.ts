/** Speech to text inside the browser, with no API key and no server.
 *
 * Whisper runs locally through transformers.js (ONNX Runtime, WebGPU where
 * available and WASM otherwise). The model is downloaded once and cached by
 * the browser, so only the first run pays for it.
 *
 * This is what makes the transcript-driven features - removing restatements,
 * condensing to a length, captions, highlights - work without an account.
 */

import type { TranscriptSegment } from "@/types/ai";

/** Models known to carry ONNX weights with timestamp support. */
export const SPEECH_MODELS = [
  {
    id: "onnx-community/whisper-base_timestamped",
    label: "標準（約80MB・推奨）",
    size: "約80MB",
  },
  {
    id: "onnx-community/whisper-tiny_timestamped",
    label: "軽量（約40MB・速いが精度は落ちます）",
    size: "約40MB",
  },
  {
    id: "onnx-community/whisper-small_timestamped",
    label: "高精度（約250MB・遅いが精度が高い）",
    size: "約250MB",
  },
] as const;

export const DEFAULT_SPEECH_MODEL = SPEECH_MODELS[0].id;

/** Whisper is trained on 16 kHz mono audio. */
export const WHISPER_SAMPLE_RATE = 16_000;

export interface SpeechProgress {
  /** "モデルを準備中" or "音声を認識中". */
  stage: string;
  /** 0..1, or null while the total is unknown. */
  progress: number | null;
}

export interface TranscribeOptions {
  modelId?: string;
  /** ISO code such as "ja", or "auto" to let the model decide. */
  language?: string;
  onProgress?: (progress: SpeechProgress) => void;
  signal?: AbortSignal;
}

/**
 * Decodes and resamples to what Whisper expects.
 *
 * decodeAudioData resamples to the context's rate, so asking for a 16 kHz
 * context does the conversion without a separate resampling pass.
 */
export async function toWhisperInput(blob: Blob): Promise<Float32Array> {
  const bytes = await blob.arrayBuffer();
  const context = new OfflineAudioContext(1, 1, WHISPER_SAMPLE_RATE);
  const decoded = await context.decodeAudioData(bytes);

  if (decoded.numberOfChannels === 1) return decoded.getChannelData(0);

  const mixed = new Float32Array(decoded.length);
  for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) {
    const data = decoded.getChannelData(channel);
    for (let index = 0; index < data.length; index += 1) {
      mixed[index] = (mixed[index] ?? 0) + (data[index] ?? 0) / decoded.numberOfChannels;
    }
  }
  return mixed;
}

/** Shape of a chunk in the pipeline's output. */
interface WhisperChunk {
  timestamp: [number, number | null];
  text: string;
}

/**
 * Maps pipeline output onto transcript segments.
 *
 * A chunk whose end timestamp is missing - which Whisper does for the last
 * chunk, and sometimes mid-stream - is closed at the next chunk's start rather
 * than dropped, so the tail of a recording is not silently lost.
 */
export function toSegments(
  chunks: WhisperChunk[],
  totalDuration: number,
): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];

  chunks.forEach((chunk, index) => {
    const text = chunk.text.trim();
    if (text.length === 0) return;

    const start = chunk.timestamp[0];
    const end =
      chunk.timestamp[1] ??
      chunks[index + 1]?.timestamp[0] ??
      Math.max(totalDuration, start + 1);

    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;
    segments.push({ start, end, text });
  });

  return segments;
}

/** Cached pipelines, keyed by model: loading one takes seconds. */
const pipelines = new Map<string, Promise<unknown>>();

async function getPipeline(
  modelId: string,
  onProgress?: (progress: SpeechProgress) => void,
): Promise<(input: Float32Array, options: Record<string, unknown>) => Promise<unknown>> {
  let existing = pipelines.get(modelId);

  if (!existing) {
    existing = (async () => {
      const { pipeline, env } = await import("@huggingface/transformers");
      // Models come from the hub and are cached by the browser; nothing is
      // bundled with the app.
      env.allowLocalModels = false;

      return pipeline("automatic-speech-recognition", modelId, {
        progress_callback: (report: { status?: string; progress?: number }) => {
          if (!onProgress) return;
          onProgress({
            stage: "モデルを準備中",
            progress:
              typeof report.progress === "number" ? report.progress / 100 : null,
          });
        },
      });
    })();
    pipelines.set(modelId, existing);

    // A failed load must not be cached, or every later attempt fails too.
    existing.catch(() => pipelines.delete(modelId));
  }

  return (await existing) as (
    input: Float32Array,
    options: Record<string, unknown>,
  ) => Promise<unknown>;
}

/** Transcribes audio in the browser. Throws with a readable message. */
export async function transcribeInBrowser(
  blob: Blob,
  options: TranscribeOptions = {},
): Promise<TranscriptSegment[]> {
  const modelId = options.modelId || DEFAULT_SPEECH_MODEL;

  const audio = await toWhisperInput(blob);
  const duration = audio.length / WHISPER_SAMPLE_RATE;
  options.signal?.throwIfAborted();

  let transcriber;
  try {
    transcriber = await getPipeline(modelId, options.onProgress);
  } catch (error) {
    throw new Error(
      `音声認識モデルを読み込めませんでした（${modelId}）。` +
        `ネットワーク接続を確認するか、設定で別のモデルを選んでください。\n` +
        (error instanceof Error ? error.message : String(error)),
    );
  }

  options.signal?.throwIfAborted();
  options.onProgress?.({ stage: "音声を認識中", progress: null });

  const language = options.language && options.language !== "auto" ? options.language : undefined;

  const result = (await transcriber(audio, {
    // 30 s is Whisper's native window; the stride gives the model context
    // either side of a boundary so words are not cut in half.
    chunk_length_s: 30,
    stride_length_s: 5,
    return_timestamps: true,
    task: "transcribe",
    ...(language ? { language } : {}),
  })) as { chunks?: WhisperChunk[]; text?: string };

  if (!result.chunks || result.chunks.length === 0) {
    // Text without timings cannot drive a cut, so it is reported as empty
    // rather than as one segment spanning the whole clip.
    return [];
  }
  return toSegments(result.chunks, duration);
}

/** True when this browser can run the local model at all. */
export function isSupported(): boolean {
  return typeof WebAssembly !== "undefined";
}
