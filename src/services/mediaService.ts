/** Media import pipeline (design doc sections 8, 46).
 *
 * Import -> probe -> register -> thumbnail + proxy in the background.
 */

import { backend, isTauri } from "./backend";
import { registerBrowserFile } from "./mockBackend";
import { useEditorStore } from "@/store/editorStore";
import { useUIStore } from "@/store/uiStore";
import { appError, userMessage } from "@/types/errors";
import type { MediaItem } from "@/types/media";

const VIDEO_EXTENSIONS = ["mp4", "mov", "mkv", "avi", "webm", "m4v"];
const AUDIO_EXTENSIONS = ["wav", "mp3", "aac", "m4a", "flac", "ogg"];
const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "bmp", "gif"];

export const SUPPORTED_EXTENSIONS = [
  ...VIDEO_EXTENSIONS,
  ...AUDIO_EXTENSIONS,
  ...IMAGE_EXTENSIONS,
];

export function isSupportedFile(name: string): boolean {
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  return SUPPORTED_EXTENSIONS.includes(extension);
}

/** Imports files chosen in the desktop shell. */
export async function importPaths(paths: string[]): Promise<MediaItem[]> {
  const ui = useUIStore.getState();
  const supported = paths.filter((path) => isSupportedFile(path));
  if (supported.length === 0) {
    ui.pushError(appError("codec_unsupported", userMessage("codec_unsupported")));
    return [];
  }

  try {
    const items = await backend().importMedia(supported);
    useEditorStore.getState().addMedia(items);
    ui.setStatus(`${items.length}件のメディアを読み込みました`);
    void generateDerivedAssets(items);
    return items;
  } catch (error) {
    ui.pushError(appError("media_corrupt", userMessage("media_corrupt"), String(error)));
    return [];
  }
}

/** Imports files dropped onto the window (browser and desktop both). */
export async function importDroppedFiles(files: File[]): Promise<MediaItem[]> {
  const supported = files.filter((file) => isSupportedFile(file.name));
  if (supported.length === 0) return [];

  if (isTauri()) {
    // In the desktop shell the drop event carries real paths.
    return importPaths(supported.map((file) => file.name));
  }

  const paths = supported.map((file) => registerBrowserFile(file).path);
  return importPaths(paths);
}

/**
 * Kicks off thumbnail and proxy generation. Failures degrade gracefully: the
 * clip is still editable, just without a thumbnail or proxy.
 */
async function generateDerivedAssets(items: MediaItem[]): Promise<void> {
  const editor = useEditorStore.getState();
  for (const item of items) {
    if (item.type === "audio") continue;
    try {
      const thumbnailPath = await backend().generateThumbnail(
        item.id,
        Math.min(1, item.duration / 2),
      );
      editor.updateMedia(item.id, { thumbnailPath });
    } catch {
      /* thumbnails are optional */
    }
    try {
      const proxyPath = await backend().generateProxy(item.id);
      editor.updateMedia(item.id, { proxyPath });
    } catch {
      /* proxies are optional - preview falls back to the original */
    }
  }
}

/** Resolves the URL the preview element should load for a media item. */
export function previewUrl(item: MediaItem): string {
  const useProxies = useEditorStore.getState().project.settings.useProxies;
  return backend().mediaUrl(item, useProxies);
}
