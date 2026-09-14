/** Background job queue contract shared with the Rust core (section 53). */

export type BackgroundJobType =
  | "proxy"
  | "thumbnail"
  | "waveform"
  | "transcription"
  | "ai_analysis"
  | "export";

export type BackgroundJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface BackgroundJob {
  id: string;
  type: BackgroundJobType;
  status: BackgroundJobStatus;
  /** 0..1 */
  progress: number;
  label: string;
  /** Set for media-scoped jobs (proxy, thumbnail, transcription). */
  mediaId?: string;
  /** Seconds, estimated by the Rust core from observed throughput. */
  etaSeconds?: number;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
}
