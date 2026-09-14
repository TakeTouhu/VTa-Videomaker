/** Audio analysis in the browser, using the Web Audio API.
 *
 * The desktop build shells out to FFmpeg for this; in the browser the same
 * results come from decodeAudioData, which is both available everywhere and
 * considerably faster than running FFmpeg through WebAssembly.
 */

import type { SilenceRange } from "@/types/ai";

/** Buckets per second of audio, matching the desktop waveform resolution. */
export const BUCKETS_PER_SECOND = 40;

/** Decodes a media file to raw samples. Files with no audio yield null. */
export async function decodeAudio(blob: Blob): Promise<AudioBuffer | null> {
  const bytes = await blob.arrayBuffer();
  // OfflineAudioContext avoids creating an output device just to decode.
  const context = new OfflineAudioContext(1, 1, 44100);
  try {
    return await context.decodeAudioData(bytes);
  } catch {
    // Video with no audio track, or a container the browser cannot decode.
    return null;
  }
}

/** Mixes every channel down to one, which is all the analysis needs. */
export function toMono(buffer: AudioBuffer): Float32Array {
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0);

  const mixed = new Float32Array(buffer.length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < data.length; index += 1) {
      mixed[index] = (mixed[index] ?? 0) + (data[index] ?? 0) / buffer.numberOfChannels;
    }
  }
  return mixed;
}

/** Reduces samples to normalised peaks, one per bucket. */
export function peaks(samples: Float32Array, bucketCount: number): number[] {
  if (samples.length === 0 || bucketCount <= 0) {
    return new Array(Math.max(0, bucketCount)).fill(0);
  }

  const result: number[] = [];
  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const start = Math.floor((bucket * samples.length) / bucketCount);
    const end = Math.max(
      start + 1,
      Math.floor(((bucket + 1) * samples.length) / bucketCount),
    );

    let peak = 0;
    for (let index = start; index < end && index < samples.length; index += 1) {
      const value = Math.abs(samples[index]!);
      if (value > peak) peak = value;
    }
    result.push(Math.min(1, peak));
  }
  return result;
}

export function waveform(buffer: AudioBuffer): number[] {
  const bucketCount = Math.max(1, Math.ceil(buffer.duration * BUCKETS_PER_SECOND));
  return peaks(toMono(buffer), bucketCount);
}

export interface SilenceOptions {
  /** Threshold in dBFS. Anything quieter counts as silence. */
  noiseDb: number;
  /** Stretches shorter than this are not reported. */
  minDurationSeconds: number;
}

export const DEFAULT_SILENCE_OPTIONS: SilenceOptions = {
  noiseDb: -30,
  minDurationSeconds: 0.5,
};

/**
 * Finds silent stretches, matching FFmpeg's silencedetect semantics: a window
 * is silent when its RMS is below the threshold, and only runs longer than the
 * minimum are reported.
 */
export function detectSilence(
  buffer: AudioBuffer,
  options: SilenceOptions = DEFAULT_SILENCE_OPTIONS,
): SilenceRange[] {
  const samples = toMono(buffer);
  const rate = buffer.sampleRate;
  // 20 ms windows: short enough to place a cut, long enough for a stable RMS.
  const windowSize = Math.max(1, Math.floor(rate * 0.02));
  const threshold = 10 ** (options.noiseDb / 20);

  const ranges: SilenceRange[] = [];
  let runStart: number | null = null;

  for (let start = 0; start < samples.length; start += windowSize) {
    const end = Math.min(start + windowSize, samples.length);

    let sum = 0;
    for (let index = start; index < end; index += 1) {
      sum += samples[index]! * samples[index]!;
    }
    const rms = Math.sqrt(sum / (end - start));

    if (rms < threshold) {
      if (runStart === null) runStart = start;
      continue;
    }
    if (runStart !== null) {
      pushRange(ranges, runStart / rate, start / rate, options.minDurationSeconds);
      runStart = null;
    }
  }

  // A file that ends in silence still closes its final run.
  if (runStart !== null) {
    pushRange(ranges, runStart / rate, samples.length / rate, options.minDurationSeconds);
  }
  return ranges;
}

function pushRange(
  ranges: SilenceRange[],
  start: number,
  end: number,
  minDuration: number,
): void {
  if (end - start >= minDuration) ranges.push({ start, end });
}

/**
 * Integrated loudness and true peak, approximated for AI audio correction.
 *
 * This is an RMS-based approximation rather than a full EBU R128 measurement -
 * close enough to level clips against each other, and the UI says so.
 */
export function measureLoudness(buffer: AudioBuffer): {
  integratedLufs: number;
  truePeakDb: number;
} {
  const samples = toMono(buffer);
  if (samples.length === 0) return { integratedLufs: -70, truePeakDb: -70 };

  let sum = 0;
  let peak = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const value = samples[index]!;
    sum += value * value;
    const magnitude = Math.abs(value);
    if (magnitude > peak) peak = magnitude;
  }

  const rms = Math.sqrt(sum / samples.length);
  return {
    integratedLufs: rms > 0 ? 20 * Math.log10(rms) : -70,
    truePeakDb: peak > 0 ? 20 * Math.log10(peak) : -70,
  };
}

/** Envelope at a fixed rate, used to align multicam angles by their audio. */
export function envelope(buffer: AudioBuffer, perSecond = BUCKETS_PER_SECOND): number[] {
  return peaks(toMono(buffer), Math.max(1, Math.ceil(buffer.duration * perSecond)));
}

/**
 * Lag, in envelope samples, that best aligns `candidate` with `reference`,
 * plus the correlation there. Mirrors the desktop implementation.
 */
export function bestLag(
  reference: number[],
  candidate: number[],
  maxLag: number,
): { lag: number; confidence: number } {
  if (reference.length === 0 || candidate.length === 0) {
    return { lag: 0, confidence: 0 };
  }

  let bestLagValue = 0;
  let bestScore = -1;
  const limit = Math.min(maxLag, Math.max(reference.length, candidate.length));

  for (let lag = -limit; lag <= limit; lag += 1) {
    let sum = 0;
    let referenceEnergy = 0;
    let candidateEnergy = 0;
    let overlap = 0;

    for (let index = 0; index < reference.length; index += 1) {
      const shifted = index - lag;
      if (shifted < 0 || shifted >= candidate.length) continue;
      const a = reference[index]!;
      const b = candidate[shifted]!;
      sum += a * b;
      referenceEnergy += a * a;
      candidateEnergy += b * b;
      overlap += 1;
    }

    if (overlap < 8) continue;
    const denominator = Math.sqrt(referenceEnergy * candidateEnergy);
    if (denominator <= Number.EPSILON) continue;

    const score = sum / denominator;
    if (score > bestScore) {
      bestScore = score;
      bestLagValue = lag;
    }
  }

  return { lag: bestLagValue, confidence: Math.max(0, bestScore) };
}
