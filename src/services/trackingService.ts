/** Mask motion tracking, run in the Rust core (design doc section 17). */

import { backend } from "./backend";
import { useEditorStore } from "@/store/editorStore";
import { useUIStore } from "@/store/uiStore";
import * as fx from "@/features/timeline/effectCommands";
import * as engine from "@/features/timeline/engine";
import { appError } from "@/types/errors";
import type { MaskShape } from "@/types/effects";

/** Bounding box of a mask shape, in normalised coordinates. */
export function maskBounds(shape: MaskShape): [number, number, number, number] {
  switch (shape.kind) {
    case "rectangle":
      return [shape.x, shape.y, shape.width, shape.height];
    case "ellipse":
      return [
        shape.x - shape.radiusX,
        shape.y - shape.radiusY,
        shape.radiusX * 2,
        shape.radiusY * 2,
      ];
    case "polygon": {
      if (shape.points.length === 0) return [0, 0, 0, 0];
      const xs = shape.points.map((point) => point.x);
      const ys = shape.points.map((point) => point.y);
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      return [minX, minY, Math.max(...xs) - minX, Math.max(...ys) - minY];
    }
  }
}

export async function trackMask(clipId: string, maskId: string): Promise<void> {
  const editor = useEditorStore.getState();
  const ui = useUIStore.getState();

  const clip = engine.findClip(editor.sequence(), clipId);
  const mask = clip?.masks?.find((entry) => entry.id === maskId);
  if (!clip || !mask || !clip.mediaId) {
    ui.pushError(appError("unknown", "トラッキングできるマスクがありません"));
    return;
  }

  ui.setStatus("トラッキング中…");
  try {
    const samples = await backend().trackMask(
      clip.mediaId,
      clip.sourceIn,
      clip.sourceOut - clip.sourceIn,
      maskBounds(mask.shape),
    );
    editor.dispatch(fx.setMaskTrackCommand(clipId, maskId, samples));

    const weak = samples.filter((sample) => sample.confidence < 0.5).length;
    ui.setStatus(
      weak > 0
        ? `トラッキング完了（${weak}フレームは信頼度が低いため確認してください）`
        : "トラッキングが完了しました",
    );
  } catch (error) {
    ui.pushError(appError("unknown", "トラッキングに失敗しました", String(error)));
  }
}
