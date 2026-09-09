/** Preview transport state (design doc section 10). */

import { create } from "zustand";

export type PreviewSource =
  | { kind: "none" }
  | { kind: "media"; mediaId: string }
  | { kind: "sequence" };

export interface PlaybackState {
  playing: boolean;
  /** Playback rate, 1 = realtime. */
  rate: number;
  volume: number;
  muted: boolean;
  source: PreviewSource;
  /** In / out points on the source monitor, seconds. */
  inPoint: number | null;
  outPoint: number | null;

  play(): void;
  pause(): void;
  toggle(): void;
  setRate(rate: number): void;
  setVolume(volume: number): void;
  toggleMute(): void;
  showMedia(mediaId: string): void;
  showSequence(): void;
  setInPoint(time: number | null): void;
  setOutPoint(time: number | null): void;
  clearInOut(): void;
}

export const PLAYBACK_RATES = [0.25, 0.5, 1, 1.5, 2, 4] as const;

export const usePlaybackStore = create<PlaybackState>((set) => ({
  playing: false,
  rate: 1,
  volume: 1,
  muted: false,
  source: { kind: "sequence" },
  inPoint: null,
  outPoint: null,

  play: () => set({ playing: true }),
  pause: () => set({ playing: false }),
  toggle: () => set((state) => ({ playing: !state.playing })),
  setRate: (rate) => set({ rate }),
  setVolume: (volume) => set({ volume: Math.min(1, Math.max(0, volume)) }),
  toggleMute: () => set((state) => ({ muted: !state.muted })),
  showMedia: (mediaId) => set({ source: { kind: "media", mediaId }, playing: false }),
  showSequence: () => set({ source: { kind: "sequence" }, playing: false }),
  setInPoint: (time) => set({ inPoint: time }),
  setOutPoint: (time) => set({ outPoint: time }),
  clearInOut: () => set({ inPoint: null, outPoint: null }),
}));
