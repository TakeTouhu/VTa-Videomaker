/** Drag & drop contract between the media panel and the timeline. */

export const MEDIA_DRAG_TYPE = "application/x-ai-video-editor-media";
export const CLIP_DRAG_TYPE = "application/x-ai-video-editor-clip";

export interface ClipDragPayload {
  clipId: string;
  /** Seconds between the clip start and the grab point. */
  grabOffset: number;
}
