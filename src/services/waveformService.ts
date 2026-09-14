/** Waveform loading with an in-memory cache and request de-duplication.
 *
 * The Rust core caches peaks on disk; this avoids re-crossing the IPC boundary
 * for every clip that shares a media item.
 */

import { backend } from "./backend";

const cache = new Map<string, number[]>();
const inFlight = new Map<string, Promise<number[]>>();

export async function loadWaveform(mediaId: string): Promise<number[]> {
  const cached = cache.get(mediaId);
  if (cached) return cached;

  const existing = inFlight.get(mediaId);
  if (existing) return existing;

  const request = backend()
    .generateWaveform(mediaId)
    .then((peaks) => {
      cache.set(mediaId, peaks);
      return peaks;
    })
    .catch(() => {
      // A missing waveform is not an error the user needs to see; the clip
      // simply renders without one.
      cache.set(mediaId, []);
      return [];
    })
    .finally(() => {
      inFlight.delete(mediaId);
    });

  inFlight.set(mediaId, request);
  return request;
}

/** Clears cached peaks, e.g. when media is removed from the project. */
export function invalidateWaveform(mediaId: string): void {
  cache.delete(mediaId);
}
