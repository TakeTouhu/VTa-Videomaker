import { describe, expect, it } from "vitest";
import {
  bestLag,
  detectSilence,
  measureLoudness,
  peaks,
  toMono,
  waveform,
} from "./audioAnalysis";

/** Minimal AudioBuffer stand-in: the analysis only reads these members. */
function makeBuffer(channels: Float32Array[], sampleRate = 48000): AudioBuffer {
  const length = channels[0]?.length ?? 0;
  return {
    numberOfChannels: channels.length,
    length,
    sampleRate,
    duration: length / sampleRate,
    getChannelData: (index: number) => channels[index]!,
  } as unknown as AudioBuffer;
}

function tone(length: number, amplitude: number): Float32Array {
  const samples = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    samples[index] = Math.sin((index / 20) * Math.PI * 2) * amplitude;
  }
  return samples;
}

describe("peaks", () => {
  it("reduces samples to the requested bucket count", () => {
    expect(peaks(new Float32Array(1000), 25)).toHaveLength(25);
  });

  it("normalises a full scale peak to one", () => {
    const samples = new Float32Array([0, 1, 0, 0]);
    expect(peaks(samples, 1)[0]).toBeCloseTo(1);
  });

  it("takes the absolute peak, so a negative trough counts", () => {
    const samples = new Float32Array([0.1, 0.1, -0.9, -0.9]);
    const result = peaks(samples, 2);
    expect(result[1]!).toBeGreaterThan(result[0]!);
    expect(result[1]!).toBeCloseTo(0.9);
  });

  it("reads silence as zero", () => {
    expect(peaks(new Float32Array(64), 4).every((value) => value === 0)).toBe(true);
  });

  it("returns a flat line rather than throwing on empty audio", () => {
    expect(peaks(new Float32Array(0), 5)).toEqual([0, 0, 0, 0, 0]);
  });
});

describe("toMono", () => {
  it("passes a mono buffer straight through", () => {
    const channel = new Float32Array([0.5, -0.5]);
    expect(toMono(makeBuffer([channel]))).toBe(channel);
  });

  it("averages the channels of a stereo buffer", () => {
    const mixed = toMono(
      makeBuffer([new Float32Array([1, 0]), new Float32Array([0, 1])]),
    );
    expect(mixed[0]).toBeCloseTo(0.5);
    expect(mixed[1]).toBeCloseTo(0.5);
  });
});

describe("waveform", () => {
  it("produces one bucket per 1/40 second", () => {
    const buffer = makeBuffer([new Float32Array(48000)], 48000);
    expect(waveform(buffer)).toHaveLength(40);
  });
});

describe("detectSilence", () => {
  /** One second loud, one second silent, one second loud. */
  function speechWithGap(): AudioBuffer {
    const rate = 48000;
    const samples = new Float32Array(rate * 3);
    samples.set(tone(rate, 0.5), 0);
    samples.set(tone(rate, 0.5), rate * 2);
    return makeBuffer([samples], rate);
  }

  it("finds the silent stretch", () => {
    const ranges = detectSilence(speechWithGap());
    expect(ranges).toHaveLength(1);
    expect(ranges[0]!.start).toBeCloseTo(1, 1);
    expect(ranges[0]!.end).toBeCloseTo(2, 1);
  });

  it("ignores a gap shorter than the minimum", () => {
    const ranges = detectSilence(speechWithGap(), {
      noiseDb: -30,
      minDurationSeconds: 5,
    });
    expect(ranges).toHaveLength(0);
  });

  it("closes a run that reaches the end of the file", () => {
    const rate = 48000;
    const samples = new Float32Array(rate * 2);
    samples.set(tone(rate, 0.5), 0);
    const ranges = detectSilence(makeBuffer([samples], rate));
    expect(ranges).toHaveLength(1);
    expect(ranges[0]!.end).toBeCloseTo(2, 1);
  });

  it("reports nothing for continuous speech", () => {
    const rate = 48000;
    expect(detectSilence(makeBuffer([tone(rate * 2, 0.5)], rate))).toHaveLength(0);
  });

  it("treats the whole file as silent when it is", () => {
    const rate = 48000;
    const ranges = detectSilence(makeBuffer([new Float32Array(rate * 2)], rate));
    expect(ranges).toHaveLength(1);
  });
});

describe("measureLoudness", () => {
  it("reports a quiet clip as quieter than a loud one", () => {
    const rate = 48000;
    const quiet = measureLoudness(makeBuffer([tone(rate, 0.05)], rate));
    const loud = measureLoudness(makeBuffer([tone(rate, 0.8)], rate));
    expect(quiet.integratedLufs).toBeLessThan(loud.integratedLufs);
  });

  it("reports the true peak", () => {
    const rate = 48000;
    const { truePeakDb } = measureLoudness(makeBuffer([tone(rate, 1)], rate));
    expect(truePeakDb).toBeCloseTo(0, 0);
  });

  it("floors silence rather than returning -Infinity", () => {
    const result = measureLoudness(makeBuffer([new Float32Array(100)]));
    expect(Number.isFinite(result.integratedLufs)).toBe(true);
  });
});

describe("bestLag", () => {
  /** An envelope with a burst of sound starting at `at`. */
  function envelopeWithBurst(length: number, at: number): number[] {
    const values = new Array<number>(length).fill(0.02);
    for (let index = at; index < Math.min(at + 6, length); index += 1) {
      values[index] = 0.9;
    }
    return values;
  }

  it("finds zero lag for identical audio", () => {
    const reference = envelopeWithBurst(200, 50);
    const { lag, confidence } = bestLag(reference, reference, 60);
    expect(lag).toBe(0);
    expect(confidence).toBeGreaterThan(0.99);
  });

  it("finds the lag of a delayed angle", () => {
    const result = bestLag(envelopeWithBurst(200, 50), envelopeWithBurst(200, 70), 60);
    expect(result.lag).toBe(-20);
    expect(result.confidence).toBeGreaterThan(0.9);
  });

  it("finds the lag of an early angle", () => {
    expect(bestLag(envelopeWithBurst(200, 70), envelopeWithBurst(200, 50), 60).lag).toBe(20);
  });

  it("reports low confidence for unrelated audio", () => {
    const noise = Array.from({ length: 200 }, (_, index) => (index % 7) / 100);
    expect(bestLag(envelopeWithBurst(200, 50), noise, 60).confidence).toBeLessThan(0.9);
  });

  it("does not throw on empty input", () => {
    expect(bestLag([], [0.1], 10)).toEqual({ lag: 0, confidence: 0 });
  });
});
