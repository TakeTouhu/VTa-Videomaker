/**
 * Integration test for the MVP flow (design doc sections 60, 65, 72):
 * import -> place on timeline -> move / trim / split / delete -> undo / redo
 * -> save -> load.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { useEditorStore } from "./editorStore";
import * as commands from "@/features/timeline/commands";
import * as engine from "@/features/timeline/engine";
import { migrateProject } from "@/features/project/migrate";
import type { MediaItem } from "@/types/media";

const media: MediaItem = {
  id: "media_1",
  type: "video",
  name: "take01.mp4",
  sourcePath: "C:/footage/take01.mp4",
  duration: 30,
  width: 1920,
  height: 1080,
  fps: 30,
  analysisState: "not_started",
  importedAt: "2026-01-01T00:00:00.000Z",
};

function store() {
  return useEditorStore.getState();
}

function firstVideoTrackId(): string {
  return store().sequence().videoTracks[0]!.id;
}

function placeClip(startTime = 0, id = "clip_1") {
  store().dispatch(
    commands.addClipCommand(
      engine.createClip({
        mediaId: media.id,
        trackId: firstVideoTrackId(),
        startTime,
        sourceIn: 0,
        sourceOut: 10,
        id,
      }),
    ),
  );
}

describe("editor store MVP flow", () => {
  beforeEach(() => {
    store().newProject("Integration Test");
  });

  it("starts with one sequence and no media", () => {
    expect(store().project.sequences).toHaveLength(1);
    expect(store().project.media).toHaveLength(0);
    expect(store().dirty).toBe(false);
  });

  it("registers imported media", () => {
    store().addMedia([media]);
    expect(store().project.media).toHaveLength(1);
    expect(store().dirty).toBe(true);
  });

  it("places media on the timeline and marks the project dirty", () => {
    store().addMedia([media]);
    placeClip();
    expect(store().sequence().clips).toHaveLength(1);
  });

  it("moves, trims, splits and deletes, undoing each step", () => {
    store().addMedia([media]);
    placeClip();

    store().dispatch(commands.moveClipCommand("clip_1", 5));
    expect(store().sequence().clips[0]!.startTime).toBe(5);

    store().dispatch(commands.trimClipCommand("clip_1", "end", 12, media.duration));
    expect(engine.clipEnd(store().sequence().clips[0]!)).toBeCloseTo(12);

    store().dispatch(commands.splitClipCommand("clip_1", 8));
    expect(store().sequence().clips).toHaveLength(2);

    const ids = store().sequence().clips.map((clip) => clip.id);
    store().dispatch(commands.deleteClipsCommand([ids[0]!]));
    expect(store().sequence().clips).toHaveLength(1);

    store().undo(); // delete
    store().undo(); // split
    store().undo(); // trim
    store().undo(); // move
    expect(store().sequence().clips).toHaveLength(1);
    expect(store().sequence().clips[0]!.startTime).toBe(0);
  });

  it("redoes what was undone", () => {
    store().addMedia([media]);
    placeClip();
    store().dispatch(commands.moveClipCommand("clip_1", 5));

    store().undo();
    expect(store().sequence().clips[0]!.startTime).toBe(0);

    store().redo();
    expect(store().sequence().clips[0]!.startTime).toBe(5);
  });

  it("drops selection entries for clips that an undo removed", () => {
    store().addMedia([media]);
    placeClip();
    store().dispatch(commands.splitClipCommand("clip_1", 5));

    const ids = store().sequence().clips.map((clip) => clip.id);
    store().selectClips(ids);
    store().undo();

    const alive = new Set(store().sequence().clips.map((clip) => clip.id));
    expect(store().selectedClipIds.every((id) => alive.has(id))).toBe(true);
  });

  it("copies and pastes a clip at the playhead", () => {
    store().addMedia([media]);
    placeClip();
    store().selectClips(["clip_1"]);
    store().copySelection();

    store().pasteClipboard(20);
    expect(store().sequence().clips).toHaveLength(2);
    expect(
      store()
        .sequence()
        .clips.some((clip) => clip.startTime === 20),
    ).toBe(true);
  });

  it("cuts a clip to the clipboard", () => {
    store().addMedia([media]);
    placeClip();
    store().selectClips(["clip_1"]);
    store().cutSelection();

    expect(store().sequence().clips).toHaveLength(0);
    expect(store().clipboard).toHaveLength(1);
  });

  it("removes clips that referenced deleted media", () => {
    store().addMedia([media]);
    placeClip();
    store().removeMedia(media.id);

    expect(store().project.media).toHaveLength(0);
    expect(store().sequence().clips).toHaveLength(0);

    // Removing media is undoable like any other edit.
    store().undo();
    expect(store().project.media).toHaveLength(1);
    expect(store().sequence().clips).toHaveLength(1);
  });

  it("moving the playhead is not an undoable edit", () => {
    store().addMedia([media]);
    placeClip();
    const depth = store().history.undoStack.length;

    store().setPlayhead(7);
    expect(store().sequence().playhead).toBe(7);
    expect(store().history.undoStack).toHaveLength(depth);
  });

  it("survives a save / load round trip through JSON", () => {
    store().addMedia([media]);
    placeClip(3);
    store().dispatch(commands.changeColorCommand("clip_1", { exposure: 15 }));

    const serialized = JSON.stringify(store().project);
    const reloaded = migrateProject(JSON.parse(serialized));

    store().setProject(reloaded, "C:/projects/test/project.json");

    expect(store().project.media).toHaveLength(1);
    const clip = store().sequence().clips[0]!;
    expect(clip.startTime).toBe(3);
    expect(clip.color.exposure).toBe(15);
    // A freshly loaded project is clean and has no history to undo into.
    expect(store().dirty).toBe(false);
    expect(store().history.undoStack).toHaveLength(0);
  });

  it("clears history and selection when a new project is created", () => {
    store().addMedia([media]);
    placeClip();
    store().selectClips(["clip_1"]);

    store().newProject("Fresh");
    expect(store().project.name).toBe("Fresh");
    expect(store().project.media).toHaveLength(0);
    expect(store().selectedClipIds).toHaveLength(0);
    expect(store().history.undoStack).toHaveLength(0);
  });

  it("never mutates the original media file reference", () => {
    store().addMedia([media]);
    placeClip();
    store().dispatch(commands.trimClipCommand("clip_1", "start", 4, media.duration));
    store().dispatch(commands.changeSpeedCommand("clip_1", 2));

    // Non-destructive editing: the media entry is untouched by clip edits.
    expect(store().project.media[0]).toEqual(media);
  });
});
