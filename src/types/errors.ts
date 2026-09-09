/** User-facing error taxonomy (design doc section 49). */

export type AppErrorKind =
  | "file_not_found"
  | "media_corrupt"
  | "codec_unsupported"
  | "ffmpeg_failed"
  | "ai_request_failed"
  | "ai_response_invalid"
  | "network_unavailable"
  | "disk_full"
  | "proxy_failed"
  | "render_failed"
  | "project_load_failed"
  | "unknown";

export interface AppError {
  kind: AppErrorKind;
  /** Short message shown to the user. Never contains a raw command line. */
  message: string;
  /** Full technical detail. Goes to logs, shown only behind "details". */
  detail?: string;
  recoverable: boolean;
}

export function appError(
  kind: AppErrorKind,
  message: string,
  detail?: string,
  recoverable = true,
): AppError {
  return { kind, message, detail, recoverable };
}

const USER_MESSAGES: Record<AppErrorKind, string> = {
  file_not_found: "ファイルが見つかりません。移動または削除された可能性があります。",
  media_corrupt: "この動画ファイルを読み込めませんでした。ファイルが破損しています。",
  codec_unsupported: "このコーデックには対応していません。",
  ffmpeg_failed: "メディア処理に失敗しました。",
  ai_request_failed: "AIへのリクエストに失敗しました。",
  ai_response_invalid: "AIの応答を解釈できませんでした。編集は適用されていません。",
  network_unavailable: "ネットワークに接続できません。",
  disk_full: "ディスクの空き容量が不足しています。",
  proxy_failed: "プロキシの生成に失敗しました。オリジナルで編集を続行します。",
  render_failed: "書き出しに失敗しました。",
  project_load_failed: "プロジェクトを開けませんでした。",
  unknown: "予期しないエラーが発生しました。",
};

/** Maps an internal failure to the message shown in the UI. */
export function userMessage(kind: AppErrorKind): string {
  return USER_MESSAGES[kind];
}
