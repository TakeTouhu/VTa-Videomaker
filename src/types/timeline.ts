/** Sequence / track / clip model (design doc sections 29-31). */

import type { ColorSettings } from "./color";

export interface TransformSettings {
  positionX: number;
  positionY: number;
  scale: number;
  rotation: number;
  opacity: number;
}

export const DEFAULT_TRANSFORM: TransformSettings = {
  positionX: 0,
  positionY: 0,
  scale: 100,
  rotation: 0,
  opacity: 100,
};

export interface AudioSettings {
  /** dB gain applied to the clip. 0 = unity. */
  volume: number;
  /** -100 (L) .. 100 (R) */
  pan: number;
  /** Seconds. */
  fadeIn: number;
  fadeOut: number;
  muted: boolean;
}

export const DEFAULT_AUDIO: AudioSettings = {
  volume: 0,
  pan: 0,
  fadeIn: 0,
  fadeOut: 0,
  muted: false,
};

export type TrackKind = "video" | "audio";

export interface VideoTrack {
  id: string;
  kind: "video";
  name: string;
  locked: boolean;
  hidden: boolean;
  height: number;
}

export interface AudioTrack {
  id: string;
  kind: "audio";
  name: string;
  locked: boolean;
  muted: boolean;
  solo: boolean;
  height: number;
}

export type Track = VideoTrack | AudioTrack;

export type ClipKind = "media" | "adjustment";

export interface Clip {
  id: string;
  /** Null for adjustment layers, which have no source media (section 16). */
  mediaId: string | null;
  trackId: string;
  kind: ClipKind;
  /** Position on the sequence timeline, seconds. */
  startTime: number;
  /** In / out points inside the source media, seconds, before speed. */
  sourceIn: number;
  sourceOut: number;
  /** 1 = realtime. Timeline duration is (sourceOut - sourceIn) / speed. */
  speed: number;
  transform: TransformSettings;
  color: ColorSettings;
  audio?: AudioSettings;
  label?: string;
}

export interface Sequence {
  id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  videoTracks: VideoTrack[];
  audioTracks: AudioTrack[];
  clips: Clip[];
  /** Playhead position in seconds, persisted with the project. */
  playhead: number;
}
