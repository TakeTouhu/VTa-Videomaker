/** Frame extraction from a video element, for thumbnails and tracking.
 *
 * Seeking and drawing is the only way to read arbitrary frames in a browser
 * without WebCodecs demuxing, and it works in every browser.
 */

/** Loads a video element and waits for its metadata. */
export function loadVideo(url: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = "anonymous";
    video.onloadedmetadata = () => resolve(video);
    video.onerror = () => reject(new Error("動画を読み込めませんでした"));
    video.src = url;
  });
}

/** Seeks and resolves once the frame at that time is actually presented. */
export function seekTo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const target = Math.max(0, Math.min(time, Math.max(0, video.duration - 0.001)));

    if (Math.abs(video.currentTime - target) < 1e-3 && video.readyState >= 2) {
      resolve();
      return;
    }

    const done = () => {
      video.removeEventListener("seeked", done);
      video.removeEventListener("error", fail);
      resolve();
    };
    const fail = () => {
      video.removeEventListener("seeked", done);
      video.removeEventListener("error", fail);
      reject(new Error("シークに失敗しました"));
    };

    video.addEventListener("seeked", done);
    video.addEventListener("error", fail);
    video.currentTime = target;
  });
}

/** Draws the current frame into a canvas, scaled to fit `maxWidth`. */
export function drawFrame(
  video: HTMLVideoElement,
  maxWidth: number,
  canvas?: HTMLCanvasElement,
): HTMLCanvasElement {
  const scale = Math.min(1, maxWidth / Math.max(1, video.videoWidth));
  const target = canvas ?? document.createElement("canvas");
  target.width = Math.max(1, Math.round(video.videoWidth * scale));
  target.height = Math.max(1, Math.round(video.videoHeight * scale));

  const context = target.getContext("2d");
  if (!context) throw new Error("Canvasを初期化できませんでした");
  context.drawImage(video, 0, 0, target.width, target.height);
  return target;
}

/** A thumbnail as a data URL, ready to put straight into an <img>. */
export async function extractThumbnail(
  url: string,
  atSeconds: number,
  maxWidth = 320,
): Promise<string> {
  const video = await loadVideo(url);
  try {
    await seekTo(video, atSeconds);
    return drawFrame(video, maxWidth).toDataURL("image/jpeg", 0.8);
  } finally {
    video.src = "";
  }
}

/** Grayscale pixels of one frame, for the motion tracker. */
export async function grayscaleFrame(
  video: HTMLVideoElement,
  time: number,
  width: number,
  canvas: HTMLCanvasElement,
): Promise<{ width: number; height: number; pixels: Uint8Array }> {
  await seekTo(video, time);
  drawFrame(video, width, canvas);

  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvasを初期化できませんでした");

  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = new Uint8Array(canvas.width * canvas.height);
  for (let index = 0; index < pixels.length; index += 1) {
    const offset = index * 4;
    // Rec. 601 luma, the same weighting FFmpeg's gray conversion uses.
    pixels[index] =
      0.299 * (image.data[offset] ?? 0) +
      0.587 * (image.data[offset + 1] ?? 0) +
      0.114 * (image.data[offset + 2] ?? 0);
  }
  return { width: canvas.width, height: canvas.height, pixels };
}

/** Average luma, low/high range and colour bias, for AI colour correction. */
export async function measureFrames(
  url: string,
  duration: number,
  sampleCount = 8,
): Promise<{
  lumaAverage: number;
  lumaLow: number;
  lumaHigh: number;
  saturation: number;
  blueBias: number;
}> {
  const video = await loadVideo(url);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvasを初期化できませんでした");

  let lumaTotal = 0;
  let lowTotal = 0;
  let highTotal = 0;
  let saturationTotal = 0;
  let blueTotal = 0;
  let samples = 0;

  try {
    for (let index = 0; index < sampleCount; index += 1) {
      const time = (duration * (index + 0.5)) / sampleCount;
      await seekTo(video, time);
      drawFrame(video, 160, canvas);

      const image = context.getImageData(0, 0, canvas.width, canvas.height);
      const lumas: number[] = [];
      let saturation = 0;
      let blue = 0;

      for (let offset = 0; offset < image.data.length; offset += 4) {
        const r = image.data[offset] ?? 0;
        const g = image.data[offset + 1] ?? 0;
        const b = image.data[offset + 2] ?? 0;

        lumas.push(0.299 * r + 0.587 * g + 0.114 * b);
        saturation += (Math.max(r, g, b) - Math.min(r, g, b)) / 2;
        // U in YUV: positive means the frame leans blue.
        blue += 0.492 * (b - (0.299 * r + 0.587 * g + 0.114 * b));
      }

      lumas.sort((a, b) => a - b);
      lumaTotal += lumas.reduce((sum, value) => sum + value, 0) / lumas.length;
      // 5th and 95th percentile stand in for FFmpeg's YLOW / YHIGH.
      lowTotal += lumas[Math.floor(lumas.length * 0.05)] ?? 0;
      highTotal += lumas[Math.floor(lumas.length * 0.95)] ?? 0;
      saturationTotal += saturation / (image.data.length / 4);
      blueTotal += blue / (image.data.length / 4);
      samples += 1;
    }
  } finally {
    video.src = "";
  }

  const average = (total: number) => (samples > 0 ? total / samples : 0);
  return {
    lumaAverage: average(lumaTotal),
    lumaLow: average(lowTotal),
    lumaHigh: average(highTotal),
    saturation: average(saturationTotal),
    blueBias: average(blueTotal),
  };
}
