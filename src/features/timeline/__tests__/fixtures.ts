import type { Clip, Sequence } from "@/types/timeline";
import { DEFAULT_AUDIO, DEFAULT_TRANSFORM } from "@/types/timeline";
import { DEFAULT_COLOR } from "@/types/color";

export const V1 = "v1";
export const V2 = "v2";
export const A1 = "a1";

export function makeClip(overrides: Partial<Clip> & { id: string }): Clip {
  return {
    mediaId: "m1",
    trackId: V1,
    kind: "media",
    startTime: 0,
    sourceIn: 0,
    sourceOut: 10,
    speed: 1,
    transform: { ...DEFAULT_TRANSFORM },
    color: { ...DEFAULT_COLOR },
    audio: { ...DEFAULT_AUDIO },
    ...overrides,
  };
}

export function makeSequence(clips: Clip[] = [], locked: string[] = []): Sequence {
  return {
    id: "seq",
    name: "Sequence 01",
    width: 1920,
    height: 1080,
    fps: 30,
    videoTracks: [
      {
        id: V1,
        kind: "video",
        name: "V1",
        locked: locked.includes(V1),
        hidden: false,
        height: 56,
      },
      {
        id: V2,
        kind: "video",
        name: "V2",
        locked: locked.includes(V2),
        hidden: false,
        height: 56,
      },
    ],
    audioTracks: [
      {
        id: A1,
        kind: "audio",
        name: "A1",
        locked: locked.includes(A1),
        muted: false,
        solo: false,
        height: 56,
      },
    ],
    clips,
    playhead: 0,
  };
}

/** Deterministic clip ids so split/duplicate assertions stay readable. */
export function idFactory(prefix = "new"): () => string {
  let counter = 0;
  return () => `${prefix}${++counter}`;
}
