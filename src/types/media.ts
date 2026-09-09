/** Media library domain types (design doc section 28). */

export type MediaType = "video" | "audio" | "image";

export interface MediaItem {
  id: string;
  type: MediaType;
  name: string;
  /** Absolute path of the original file. Never modified (non-destructive editing). */
  sourcePath: string;
  /** Low resolution editing proxy, generated in the background after import. */
  proxyPath?: string;
  thumbnailPath?: string;
  /** Seconds. Images use a nominal still duration. */
  duration: number;
  width?: number;
  height?: number;
  fps?: number;
  audioChannels?: number;
  /** Set once background analysis has produced a transcript / silence map. */
  analysisState?: MediaAnalysisState;
  importedAt: string;
}

export type MediaAnalysisState =
  | "not_started"
  | "queued"
  | "running"
  | "completed"
  | "failed";

/** Raw probe result returned by the Rust core (ffprobe wrapper). */
export interface MediaProbe {
  duration: number;
  width?: number;
  height?: number;
  fps?: number;
  audioChannels?: number;
  hasVideo: boolean;
  hasAudio: boolean;
  codec?: string;
}
