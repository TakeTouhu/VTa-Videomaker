/** MP4 export inside the browser, using WebCodecs.
 *
 * The desktop build hands the sequence to FFmpeg. In the browser the same
 * result is produced by rendering each frame onto a canvas and encoding it with
 * VideoEncoder, then muxing to MP4. This is hardware accelerated, so it is far
 * faster than running FFmpeg through WebAssembly.
 *
 * WebCodecs is required. Browsers without it are told so rather than being
 * handed a silently different result.
 */

import { ArrayBufferTarget as Mp4Target, Muxer as Mp4Muxer } from "mp4-muxer";
import { ArrayBufferTarget as WebmTarget, Muxer as WebmMuxer } from "webm-muxer";
import type { Clip, Sequence } from "@/types/timeline";
import type { ExportSettings } from "@/services/backend";
import * as engine from "@/features/timeline/engine";
import { resolveClipAt } from "@/features/timeline/keyframes";
import { mergeColorStack } from "@/features/color/stack";
import { colorToCssFilter } from "@/features/color/preview";
import { DEFAULT_TEXT } from "@/types/effects";
import { loadVideo, seekTo } from "./frames";
import { decodeAudio } from "./audioAnalysis";
import { getFile } from "./fileStore";

export interface ExportProgress {
  /** 0..1 */
  progress: number;
  stage: "video" | "audio" | "muxing";
}

export interface ExportRequest {
  sequence: Sequence;
  settings: ExportSettings;
  signal: AbortSignal;
  onProgress: (progress: ExportProgress) => void;
}

/** True when this browser can encode video at all. */
export function isSupported(): boolean {
  return typeof VideoEncoder !== "undefined" && typeof AudioEncoder !== "undefined";
}

export const UNSUPPORTED_MESSAGE =
  "このブラウザは書き出しに必要なWebCodecsに対応していません。" +
  "Chrome、Edge、またはSafari 16.4以降をお使いください。";

/** Audio sample rate used for the mixed output. */
const SAMPLE_RATE = 48_000;
const AUDIO_CHANNELS = 2;

/**
 * Which codecs and container this browser can actually encode.
 *
 * H.264 and AAC give the most widely playable file, but they are licensed and
 * absent from some builds (Chromium without proprietary codecs, for one). VP9
 * and Opus in WebM are royalty free and present everywhere WebCodecs is, so
 * they are the fallback rather than failing the export outright.
 */
export interface EncoderPlan {
  container: "mp4" | "webm";
  videoCodec: string;
  audioCodec: string;
  muxerVideoCodec: "avc" | "vp9" | "vp8";
  muxerAudioCodec: "aac" | "opus";
  mimeType: string;
  extension: string;
}

async function videoSupported(codec: string, width: number, height: number, fps: number, bitrate: number) {
  try {
    const support = await VideoEncoder.isConfigSupported({
      codec,
      width,
      height,
      bitrate,
      framerate: fps,
    });
    return support.supported === true;
  } catch {
    return false;
  }
}

async function audioSupported(codec: string) {
  try {
    const support = await AudioEncoder.isConfigSupported({
      codec,
      sampleRate: SAMPLE_RATE,
      numberOfChannels: AUDIO_CHANNELS,
      bitrate: 128_000,
    });
    return support.supported === true;
  } catch {
    return false;
  }
}

export async function pickEncoderPlan(
  width: number,
  height: number,
  fps: number,
  bitrate: number,
): Promise<EncoderPlan> {
  const avc = avcCodecString(width, height);

  if (
    (await videoSupported(avc, width, height, fps, bitrate)) &&
    (await audioSupported("mp4a.40.2"))
  ) {
    return {
      container: "mp4",
      videoCodec: avc,
      audioCodec: "mp4a.40.2",
      muxerVideoCodec: "avc",
      muxerAudioCodec: "aac",
      mimeType: "video/mp4",
      extension: ".mp4",
    };
  }

  for (const [codec, muxerCodec] of [
    ["vp09.00.10.08", "vp9"],
    ["vp8", "vp8"],
  ] as const) {
    if (
      (await videoSupported(codec, width, height, fps, bitrate)) &&
      (await audioSupported("opus"))
    ) {
      return {
        container: "webm",
        videoCodec: codec,
        audioCodec: "opus",
        muxerVideoCodec: muxerCodec,
        muxerAudioCodec: "opus",
        mimeType: "video/webm",
        extension: ".webm",
      };
    }
  }

  throw new Error(
    "このブラウザで利用できる映像エンコーダが見つかりませんでした。" +
      "Chrome、Edge、またはSafari 16.4以降をお使いください。",
  );
}

/** Muxer interface both containers satisfy, so the encode loop is shared. */
interface AnyMuxer {
  addVideoChunk(chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata): void;
  addAudioChunk(chunk: EncodedAudioChunk, meta?: EncodedAudioChunkMetadata): void;
  finalize(): void;
}

export interface ExportResult {
  blob: Blob;
  /** The extension the chosen container needs, e.g. ".mp4" or ".webm". */
  extension: string;
}

export async function exportSequence(request: ExportRequest): Promise<ExportResult> {
  if (!isSupported()) throw new Error(UNSUPPORTED_MESSAGE);

  const { sequence, settings, signal, onProgress } = request;
  const duration = engine.sequenceDuration(sequence);
  if (duration <= 0) throw new Error("タイムラインが空です");

  // Encoders require even dimensions.
  const width = Math.round(settings.width / 2) * 2;
  const height = Math.round(settings.height / 2) * 2;
  const fps = settings.fps > 0 ? settings.fps : 30;
  const bitrate = bitrateFor(settings) * 1000;

  const plan = await pickEncoderPlan(width, height, fps, bitrate);

  const target = plan.container === "mp4" ? new Mp4Target() : new WebmTarget();
  const muxer: AnyMuxer =
    plan.container === "mp4"
      ? new Mp4Muxer({
          target: target as Mp4Target,
          fastStart: "in-memory",
          video: { codec: "avc", width, height, frameRate: fps },
          audio: {
            codec: "aac",
            sampleRate: SAMPLE_RATE,
            numberOfChannels: AUDIO_CHANNELS,
          },
        })
      : new WebmMuxer({
          target: target as WebmTarget,
          video: { codec: plan.muxerVideoCodec === "vp9" ? "V_VP9" : "V_VP8", width, height, frameRate: fps },
          audio: {
            codec: "A_OPUS",
            sampleRate: SAMPLE_RATE,
            numberOfChannels: AUDIO_CHANNELS,
          },
        });

  // An encoder reports failures through its error callback, which runs outside
  // this promise chain. Capturing it here is what makes a codec failure show
  // up as a failed export instead of vanishing into an unhandled error.
  let encoderFailure: Error | null = null;
  const fail = (error: DOMException | Error) => {
    encoderFailure ??= error instanceof Error ? error : new Error(String(error));
  };
  const throwIfFailed = () => {
    if (encoderFailure) throw encoderFailure;
  };

  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: fail,
  });
  videoEncoder.configure({
    codec: plan.videoCodec,
    width,
    height,
    bitrate,
    framerate: fps,
  });

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("Canvasを初期化できませんでした");

  // One video element per media item, reused across frames: creating one per
  // frame would re-download and re-decode the file every time.
  const players = new Map<string, HTMLVideoElement>();
  const totalFrames = Math.ceil(duration * fps);

  try {
    for (let frame = 0; frame < totalFrames; frame += 1) {
      if (signal.aborted) throw new DOMException("キャンセルされました", "AbortError");
      throwIfFailed();

      const time = frame / fps;
      await renderFrame({ sequence, time, context, width, height, players });

      const videoFrame = new VideoFrame(canvas, {
        timestamp: Math.round((frame * 1_000_000) / fps),
        duration: Math.round(1_000_000 / fps),
      });
      try {
        // A keyframe every two seconds keeps the file seekable.
        videoEncoder.encode(videoFrame, { keyFrame: frame % (fps * 2) === 0 });
      } finally {
        // Always closed, even if encode throws, or the decoder stalls.
        videoFrame.close();
      }

      // Let the encoder drain so memory does not grow without bound.
      if (videoEncoder.encodeQueueSize > 8) await videoEncoder.flush();
      onProgress({ progress: (frame / totalFrames) * 0.85, stage: "video" });
    }

    await videoEncoder.flush();
    throwIfFailed();

    onProgress({ progress: 0.85, stage: "audio" });
    await encodeAudio(sequence, duration, muxer, signal, plan, fail);
    throwIfFailed();

    onProgress({ progress: 0.97, stage: "muxing" });
    muxer.finalize();
    onProgress({ progress: 1, stage: "muxing" });

    const buffer =
      plan.container === "mp4"
        ? (target as Mp4Target).buffer
        : (target as WebmTarget).buffer;

    return {
      blob: new Blob([buffer], { type: plan.mimeType }),
      extension: plan.extension,
    };
  } finally {
    for (const player of players.values()) player.src = "";
    if (videoEncoder.state !== "closed") videoEncoder.close();
  }
}

/* ------------------------------------------------------------------ */
/* Video                                                               */
/* ------------------------------------------------------------------ */

interface RenderContext {
  sequence: Sequence;
  time: number;
  context: CanvasRenderingContext2D;
  width: number;
  height: number;
  players: Map<string, HTMLVideoElement>;
}

/** Composites one output frame: tracks bottom to top, then captions. */
async function renderFrame(render: RenderContext): Promise<void> {
  const { sequence, time, context, width, height, players } = render;

  context.fillStyle = "#000000";
  context.fillRect(0, 0, width, height);

  const adjustments = engine.adjustmentLayersAt(sequence, time);

  for (const track of sequence.videoTracks) {
    if (track.hidden) continue;

    const raw = engine.clipAt(sequence, track.id, time);
    if (!raw || raw.kind === "adjustment") continue;

    const clip = resolveClipAt(raw, time);
    const graded = mergeColorStack(clip.color, adjustments);

    context.save();
    context.globalAlpha = Math.max(0, Math.min(1, clip.transform.opacity / 100));
    context.filter = colorToCssFilter(graded) ?? "none";

    if (clip.kind === "text") {
      drawText(context, clip, width, height);
    } else if (clip.mediaId) {
      await drawVideo({ clip, time, context, width, height, players });
    }
    context.restore();
  }

  drawCaptions(context, sequence, time, width, height);
}

async function drawVideo(options: {
  clip: Clip;
  time: number;
  context: CanvasRenderingContext2D;
  width: number;
  height: number;
  players: Map<string, HTMLVideoElement>;
}): Promise<void> {
  const { clip, time, context, width, height, players } = options;
  if (!clip.mediaId) return;

  let player = players.get(clip.mediaId);
  if (!player) {
    const blob = await getFile(clip.mediaId);
    if (!blob) return;
    player = await loadVideo(URL.createObjectURL(blob));
    players.set(clip.mediaId, player);
  }

  const speed = clip.speed > 0 ? clip.speed : 1;
  await seekTo(player, clip.sourceIn + (time - clip.startTime) * speed);

  // Fit the source inside the frame, preserving its aspect ratio.
  const scale = clip.transform.scale / 100;
  const fit = Math.min(width / player.videoWidth, height / player.videoHeight) * scale;
  const drawWidth = player.videoWidth * fit;
  const drawHeight = player.videoHeight * fit;

  context.translate(width / 2 + clip.transform.positionX, height / 2 + clip.transform.positionY);
  context.rotate((clip.transform.rotation * Math.PI) / 180);
  context.drawImage(player, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
}

function drawText(
  context: CanvasRenderingContext2D,
  clip: Clip,
  width: number,
  height: number,
): void {
  const text = { ...DEFAULT_TEXT, ...clip.text };
  context.font = `${text.bold ? "bold " : ""}${text.fontSize}px ${text.fontFamily}, sans-serif`;
  context.textAlign = text.alignment as CanvasTextAlign;
  context.textBaseline = "middle";

  const x = width * text.x;
  const lines = text.content.split("\n");
  const lineHeight = text.fontSize * 1.3;
  const startY = height * text.y - ((lines.length - 1) * lineHeight) / 2;

  lines.forEach((line, index) => {
    const y = startY + index * lineHeight;
    if (text.outlineWidth > 0) {
      context.strokeStyle = text.outlineColor;
      context.lineWidth = text.outlineWidth * 2;
      context.lineJoin = "round";
      context.strokeText(line, x, y);
    }
    context.fillStyle = text.color;
    context.fillText(line, x, y);
  });
}

function drawCaptions(
  context: CanvasRenderingContext2D,
  sequence: Sequence,
  time: number,
  width: number,
  height: number,
): void {
  for (const track of sequence.captionTracks ?? []) {
    if (!track.enabled) continue;

    for (const cue of track.cues) {
      if (time < cue.start || time >= cue.end) continue;

      const style = track.style;
      context.save();
      context.filter = "none";
      context.globalAlpha = 1;
      context.font = `${style.bold ? "bold " : ""}${style.fontSize}px ${style.fontFamily}, sans-serif`;
      context.textAlign = style.alignment as CanvasTextAlign;
      context.textBaseline = "middle";

      const x =
        style.alignment === "left"
          ? width * 0.05
          : style.alignment === "right"
            ? width * 0.95
            : width / 2;
      const lines = cue.text.split("\n");
      const lineHeight = style.fontSize * 1.3;
      const startY = height * style.positionY - ((lines.length - 1) * lineHeight) / 2;

      lines.forEach((line, index) => {
        const y = startY + index * lineHeight;
        if (style.backgroundColor) {
          const metrics = context.measureText(line);
          context.fillStyle = style.backgroundColor;
          const padding = style.fontSize * 0.25;
          const boxX =
            style.alignment === "left"
              ? x - padding
              : style.alignment === "right"
                ? x - metrics.width - padding
                : x - metrics.width / 2 - padding;
          context.fillRect(
            boxX,
            y - lineHeight / 2 - padding / 2,
            metrics.width + padding * 2,
            lineHeight + padding,
          );
        }
        if (style.outlineWidth > 0) {
          context.strokeStyle = style.outlineColor;
          context.lineWidth = style.outlineWidth * 2;
          context.lineJoin = "round";
          context.strokeText(line, x, y);
        }
        context.fillStyle = style.color;
        context.fillText(line, x, y);
      });
      context.restore();
    }
  }
}

/* ------------------------------------------------------------------ */
/* Audio                                                               */
/* ------------------------------------------------------------------ */

/** Mixes every audible clip into one buffer and encodes it as AAC. */
async function encodeAudio(
  sequence: Sequence,
  duration: number,
  muxer: AnyMuxer,
  signal: AbortSignal,
  plan: EncoderPlan,
  onError: (error: DOMException | Error) => void,
): Promise<void> {
  const mixed = await mixAudio(sequence, duration, signal);

  const encoder = new AudioEncoder({
    output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
    error: onError,
  });
  encoder.configure({
    codec: plan.audioCodec,
    sampleRate: SAMPLE_RATE,
    numberOfChannels: AUDIO_CHANNELS,
    bitrate: 192_000,
  });

  // Encoders take fixed-size chunks; 1024 frames is the AAC frame size.
  const chunkFrames = 1024;
  for (let offset = 0; offset < mixed.length; offset += chunkFrames) {
    if (signal.aborted) break;

    const frames = Math.min(chunkFrames, mixed.length - offset);
    const interleaved = new Float32Array(frames * AUDIO_CHANNELS);
    for (let frame = 0; frame < frames; frame += 1) {
      const sample = mixed[offset + frame] ?? 0;
      interleaved[frame * AUDIO_CHANNELS] = sample;
      interleaved[frame * AUDIO_CHANNELS + 1] = sample;
    }

    encoder.encode(
      new AudioData({
        format: "f32",
        sampleRate: SAMPLE_RATE,
        numberOfFrames: frames,
        numberOfChannels: AUDIO_CHANNELS,
        timestamp: Math.round((offset / SAMPLE_RATE) * 1_000_000),
        data: interleaved,
      }),
    );
  }

  await encoder.flush();
  encoder.close();
}

/** Sums every clip's audio into one mono track at the sequence sample rate. */
async function mixAudio(
  sequence: Sequence,
  duration: number,
  signal: AbortSignal,
): Promise<Float32Array> {
  const mixed = new Float32Array(Math.ceil(duration * SAMPLE_RATE));
  const soloed = sequence.audioTracks.some((track) => track.solo);

  const decoded = new Map<string, AudioBuffer | null>();

  for (const clip of sequence.clips) {
    if (signal.aborted) break;
    if (!clip.mediaId || !clip.audio || clip.audio.muted) continue;

    const track = sequence.audioTracks.find((entry) => entry.id === clip.trackId);
    // Video-track clips still carry their audio; only audio tracks can solo.
    if (track && (soloed ? !track.solo : track.muted)) continue;

    if (!decoded.has(clip.mediaId)) {
      const blob = await getFile(clip.mediaId);
      decoded.set(clip.mediaId, blob ? await decodeAudio(blob) : null);
    }
    const buffer = decoded.get(clip.mediaId);
    if (!buffer) continue;

    addClipAudio(mixed, buffer, clip);
  }

  // Clamp rather than let the sum wrap into distortion.
  for (let index = 0; index < mixed.length; index += 1) {
    mixed[index] = Math.max(-1, Math.min(1, mixed[index] ?? 0));
  }
  return mixed;
}

function addClipAudio(mixed: Float32Array, buffer: AudioBuffer, clip: Clip): void {
  const audio = clip.audio;
  if (!audio) return;

  const speed = clip.speed > 0 ? clip.speed : 1;
  const gain = 10 ** (audio.volume / 20);
  const source = buffer.getChannelData(0);
  const clipDuration = engine.clipDuration(clip);

  const startFrame = Math.floor(clip.startTime * SAMPLE_RATE);
  const frameCount = Math.floor(clipDuration * SAMPLE_RATE);

  for (let frame = 0; frame < frameCount; frame += 1) {
    const outIndex = startFrame + frame;
    if (outIndex < 0 || outIndex >= mixed.length) continue;

    const localSeconds = (frame / SAMPLE_RATE) * speed;
    const sourceIndex = Math.floor((clip.sourceIn + localSeconds) * buffer.sampleRate);
    if (sourceIndex < 0 || sourceIndex >= source.length) continue;

    let value = (source[sourceIndex] ?? 0) * gain;

    // Fades are applied in timeline time, matching the Inspector's fields.
    const position = frame / SAMPLE_RATE;
    if (audio.fadeIn > 0 && position < audio.fadeIn) {
      value *= position / audio.fadeIn;
    }
    const fromEnd = clipDuration - position;
    if (audio.fadeOut > 0 && fromEnd < audio.fadeOut) {
      value *= Math.max(0, fromEnd / audio.fadeOut);
    }

    mixed[outIndex] = (mixed[outIndex] ?? 0) + value;
  }
}

/* ------------------------------------------------------------------ */

function bitrateFor(settings: ExportSettings): number {
  switch (settings.quality) {
    case "low":
      return 4000;
    case "medium":
      return 10_000;
    case "high":
      return 20_000;
    default:
      return settings.bitrateKbps ?? 12_000;
  }
}

/** Picks an H.264 level that covers the output resolution. */
function avcCodecString(width: number, height: number): string {
  const macroblocks = Math.ceil(width / 16) * Math.ceil(height / 16);
  // High profile (64) with a level that fits: 4.0 up to 1080p, 5.1 beyond.
  if (macroblocks <= 8192) return "avc1.640028";
  return "avc1.640033";
}
