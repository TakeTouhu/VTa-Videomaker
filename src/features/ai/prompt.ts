/** Builds the model prompt for natural language editing (design doc section 24).
 *
 * The model is given a compact description of the timeline and the transcript,
 * and is required to answer with an EditPlan. It is told explicitly that it may
 * not invent clip ids - anything it invents is rejected by validation anyway,
 * but saying so up front wastes fewer round trips.
 */

import type { MediaAnalysis } from "@/types/ai";
import type { Sequence } from "@/types/timeline";
import * as engine from "@/features/timeline/engine";

/** Transcript lines beyond this are dropped to stay inside the context window. */
export const MAX_TRANSCRIPT_LINES = 400;

export const SYSTEM_PROMPT = `あなたは動画編集アシスタントです。ユーザーの指示を、タイムラインへの編集操作に変換します。

制約:
- 必ず指定されたJSONスキーマに従ったEdit Planのみを出力すること。説明文を含めない。
- clipIdは与えられたクリップ一覧に存在するものだけを使うこと。新しいIDを作らない。
- 時間は秒単位の数値で、対象クリップの範囲内にあること。
- FFmpegコマンドやフィルタ文字列は絶対に出力しないこと。編集パラメータのみを出力する。
- 削除は元の素材を消すのではなく、タイムライン上の範囲を取り除く操作である。
- 判断に迷う場合は、より保守的な（削除量の少ない）案にすること。

利用できるアクション:
- delete: 範囲を削除する {type,clipId,start,end,ripple,reason}
- cut: 位置で分割する {type,clipId,at,reason}
- move: クリップを移動する {type,clipId,startTime,trackId?,reason}
- color: 色を調整する {type,clipId,color:{exposure,contrast,highlights,shadows,whites,blacks,temperature,tint,saturation},reason}
- volume: 音量を変更する {type,clipId,volume,reason}  // dB
- speed: 速度を変更する {type,clipId,speed,reason}

summaryには、ユーザーに見せる日本語の要約を1文で書くこと。`;

export interface PromptContext {
  sequence: Sequence;
  analyses: MediaAnalysis[];
  /** Human readable media names, keyed by media id. */
  mediaNames: Record<string, string>;
}

/** Compact, token-cheap description of the current timeline. */
export function describeSequence(context: PromptContext): string {
  const { sequence, mediaNames } = context;
  const lines: string[] = [
    `シーケンス: ${sequence.name} (${sequence.width}x${sequence.height}, ${sequence.fps}fps)`,
    `全体の長さ: ${engine.sequenceDuration(sequence).toFixed(2)}秒`,
    "クリップ:",
  ];

  const tracks = [...sequence.videoTracks, ...sequence.audioTracks];
  for (const track of tracks) {
    const clips = engine.clipsOnTrack(sequence, track.id);
    if (clips.length === 0) continue;

    for (const clip of clips) {
      const name = clip.mediaId ? (mediaNames[clip.mediaId] ?? clip.mediaId) : "調整レイヤー";
      lines.push(
        `- ${clip.id} [${track.name}] ${name} ` +
          `タイムライン ${clip.startTime.toFixed(2)}〜${engine.clipEnd(clip).toFixed(2)}秒 ` +
          `素材 ${clip.sourceIn.toFixed(2)}〜${clip.sourceOut.toFixed(2)}秒 ` +
          `速度 ${clip.speed}x${track.locked ? " (ロック中・編集不可)" : ""}`,
      );
    }
  }
  return lines.join("\n");
}

/**
 * Transcript in sequence time, so the model can reference what is said at a
 * given point on the timeline without doing the source-to-timeline mapping.
 */
export function describeTranscript(context: PromptContext): string {
  const { sequence, analyses } = context;
  const lines: string[] = [];

  for (const analysis of analyses) {
    for (const segment of analysis.transcript) {
      for (const clip of sequence.clips) {
        if (clip.mediaId !== analysis.mediaId) continue;
        const speed = clip.speed > 0 ? clip.speed : 1;
        const overlapIn = Math.max(segment.start, clip.sourceIn);
        const overlapOut = Math.min(segment.end, clip.sourceOut);
        if (overlapOut <= overlapIn) continue;

        const start = clip.startTime + (overlapIn - clip.sourceIn) / speed;
        const end = clip.startTime + (overlapOut - clip.sourceIn) / speed;
        lines.push(`[${clip.id} ${start.toFixed(2)}-${end.toFixed(2)}] ${segment.text}`);
      }
    }
  }

  if (lines.length === 0) return "文字起こし: なし（音声解析が未実行、または無音）";

  lines.sort();
  const limited = lines.slice(0, MAX_TRANSCRIPT_LINES);
  const truncated =
    lines.length > MAX_TRANSCRIPT_LINES
      ? `\n（以降 ${lines.length - MAX_TRANSCRIPT_LINES} 行は省略）`
      : "";
  return `文字起こし（タイムライン時間）:\n${limited.join("\n")}${truncated}`;
}

export function buildUserPrompt(request: string, context: PromptContext): string {
  return [
    describeSequence(context),
    "",
    describeTranscript(context),
    "",
    `ユーザーの指示: ${request}`,
  ].join("\n");
}

/** JSON Schema handed to the model so it answers in the Edit Plan shape. */
export const EDIT_PLAN_JSON_SCHEMA = {
  type: "object",
  required: ["id", "prompt", "summary", "actions", "createdAt"],
  additionalProperties: false,
  properties: {
    id: { type: "string" },
    prompt: { type: "string" },
    summary: { type: "string" },
    createdAt: { type: "string" },
    actions: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        required: ["type", "clipId"],
        properties: {
          type: {
            type: "string",
            enum: ["delete", "cut", "move", "color", "volume", "speed"],
          },
          clipId: { type: "string" },
          start: { type: "number" },
          end: { type: "number" },
          at: { type: "number" },
          startTime: { type: "number" },
          trackId: { type: "string" },
          ripple: { type: "boolean" },
          volume: { type: "number" },
          speed: { type: "number" },
          reason: { type: "string" },
          color: {
            type: "object",
            properties: {
              exposure: { type: "number" },
              contrast: { type: "number" },
              highlights: { type: "number" },
              shadows: { type: "number" },
              whites: { type: "number" },
              blacks: { type: "number" },
              temperature: { type: "number" },
              tint: { type: "number" },
              saturation: { type: "number" },
            },
          },
        },
      },
    },
  },
} as const;
