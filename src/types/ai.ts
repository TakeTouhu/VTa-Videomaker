/** AI edit-plan contract (design doc sections 23, 26, 51).
 *
 * The AI never touches the timeline directly and never emits FFmpeg commands.
 * It produces an EditPlan, the plan is schema- and rule-validated, and only
 * then is it converted into ordinary undoable timeline commands.
 */

import type { ColorSettings } from "./color";

export interface CutAction {
  type: "cut";
  clipId: string;
  /** Sequence time, seconds. */
  at: number;
  reason?: string;
}

export interface DeleteAction {
  type: "delete";
  clipId: string;
  start: number;
  end: number;
  /** Close the gap left behind (ripple). */
  ripple: boolean;
  reason?: string;
}

export interface MoveAction {
  type: "move";
  clipId: string;
  startTime: number;
  trackId?: string;
  reason?: string;
}

export interface ColorAction {
  type: "color";
  clipId: string;
  color: Partial<ColorSettings>;
  reason?: string;
}

export interface VolumeAction {
  type: "volume";
  clipId: string;
  /** dB */
  volume: number;
  reason?: string;
}

export interface SpeedAction {
  type: "speed";
  clipId: string;
  speed: number;
  reason?: string;
}

export type AIEditAction =
  | CutAction
  | DeleteAction
  | MoveAction
  | ColorAction
  | VolumeAction
  | SpeedAction;

export interface EditPlan {
  id: string;
  /** The natural language request this plan answers. */
  prompt: string;
  /** One-line description shown above the Apply / Reject buttons. */
  summary: string;
  actions: AIEditAction[];
  createdAt: string;
}

export type EditPlanStatus = "pending" | "applied" | "rejected";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
  /** Attached when the assistant proposed an edit. */
  planId?: string;
}

/** History entry for the AI panel (section 62). Each is individually undoable. */
export interface AIHistoryEntry {
  id: string;
  planId: string;
  summary: string;
  appliedAt: string;
  /** History manager label used to undo exactly this AI edit. */
  commandLabel: string;
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
  confidence?: number;
}

export interface SilenceRange {
  start: number;
  end: number;
}

/** A detected object or face, in normalised 0..1 frame coordinates. */
export interface Detection {
  label: string;
  confidence: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FrameDetections {
  time: number;
  detections: Detection[];
}

/** Natural language description of a sampled frame (design doc section 47). */
export interface SceneDescription {
  time: number;
  text: string;
  tags: string[];
}

export interface FrameStats {
  lumaAverage: number;
  lumaLow: number;
  lumaHigh: number;
  saturation: number;
  blueBias: number;
}

export interface Loudness {
  integratedLufs: number;
  truePeakDb: number;
}

export interface MediaAnalysis {
  mediaId: string;
  transcript: TranscriptSegment[];
  silences: SilenceRange[];
  /** Scene boundaries, seconds. */
  scenes: number[];
  detections?: FrameDetections[];
  descriptions?: SceneDescription[];
  frameStats?: FrameStats;
  loudness?: Loudness;
  analyzedAt: string;
}

export interface AIProviderConfig {
  provider: "openai" | "local" | "mock";
  model?: string;
  /** Never persisted in project.json - stored in app settings only. */
  apiKey?: string;
  endpoint?: string;
}
