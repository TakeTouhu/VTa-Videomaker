/** Editor state: the project document, undo history and selection.
 *
 * The store owns no editing logic - it dispatches commands, which delegate to
 * the timeline engine. That keeps every mutation undoable and testable.
 */

import { create } from "zustand";
import type { Project } from "@/types/project";
import type { Clip, Sequence } from "@/types/timeline";
import type { MediaItem } from "@/types/media";
import type { EditorCommand } from "@/features/history/command";
import { snapshotCommand } from "@/features/history/command";
import * as history from "@/features/history/historyManager";
import type { HistoryState } from "@/features/history/historyManager";
import { activeSequence, createProject, replaceSequence } from "@/features/project/factory";
import * as engine from "@/features/timeline/engine";
import { createId } from "@/utils/id";

export type EditorTool = "selection" | "razor";

export interface EditorState {
  project: Project;
  history: HistoryState;
  /** Set on every command, cleared on save. Drives autosave and the title bar. */
  dirty: boolean;
  savedPath: string | null;

  selectedClipIds: string[];
  selectedMediaId: string | null;
  tool: EditorTool;
  snapEnabled: boolean;
  clipboard: Clip[];

  /* Document */
  newProject(name?: string): void;
  setProject(project: Project, path?: string | null): void;
  markSaved(path: string): void;
  renameProject(name: string): void;

  /* Media */
  addMedia(items: MediaItem[]): void;
  updateMedia(mediaId: string, patch: Partial<MediaItem>): void;
  removeMedia(mediaId: string): void;
  selectMedia(mediaId: string | null): void;

  /* Commands */
  dispatch(command: EditorCommand): void;
  undo(): void;
  redo(): void;

  /* Selection & tools */
  selectClips(clipIds: string[], additive?: boolean): void;
  clearSelection(): void;
  setTool(tool: EditorTool): void;
  toggleSnap(): void;
  copySelection(): void;
  cutSelection(): void;
  pasteClipboard(atTime: number, trackId?: string): void;

  /* Sequence */
  setPlayhead(time: number): void;
  updateSequence(transform: (sequence: Sequence) => Sequence, label?: string): void;

  /* Derived */
  sequence(): Sequence;
  mediaById(mediaId: string | null): MediaItem | undefined;
  selectedClips(): Clip[];
}

export const useEditorStore = create<EditorState>((set, get) => ({
  project: createProject(),
  history: history.emptyHistory(),
  dirty: false,
  savedPath: null,

  selectedClipIds: [],
  selectedMediaId: null,
  tool: "selection",
  snapEnabled: true,
  clipboard: [],

  newProject(name) {
    set({
      project: createProject(name),
      history: history.emptyHistory(),
      dirty: false,
      savedPath: null,
      selectedClipIds: [],
      selectedMediaId: null,
      clipboard: [],
    });
  },

  setProject(project, path) {
    set({
      project,
      history: history.emptyHistory(),
      dirty: false,
      savedPath: path ?? null,
      selectedClipIds: [],
      selectedMediaId: null,
    });
  },

  markSaved(path) {
    set({ dirty: false, savedPath: path });
  },

  renameProject(name) {
    set((state) => ({ project: { ...state.project, name }, dirty: true }));
  },

  addMedia(items) {
    if (items.length === 0) return;
    set((state) => ({
      project: {
        ...state.project,
        media: [...state.project.media, ...items],
        updatedAt: new Date().toISOString(),
      },
      dirty: true,
    }));
  },

  updateMedia(mediaId, patch) {
    set((state) => ({
      project: {
        ...state.project,
        media: state.project.media.map((item) =>
          item.id === mediaId ? { ...item, ...patch } : item,
        ),
      },
      dirty: true,
    }));
  },

  removeMedia(mediaId) {
    get().dispatch(
      snapshotCommand({ label: "Remove Media" }, (project) => {
        const sequences = project.sequences.map((sequence) => ({
          ...sequence,
          clips: sequence.clips.filter((clip) => clip.mediaId !== mediaId),
        }));
        return {
          ...project,
          media: project.media.filter((item) => item.id !== mediaId),
          sequences,
        };
      }),
    );
    set((state) => ({
      selectedMediaId: state.selectedMediaId === mediaId ? null : state.selectedMediaId,
    }));
  },

  selectMedia(mediaId) {
    set({ selectedMediaId: mediaId });
  },

  dispatch(command) {
    const state = get();
    const result = history.execute(state.project, state.history, command);
    set({ project: result.project, history: result.history, dirty: true });
  },

  undo() {
    const state = get();
    const result = history.undo(state.project, state.history);
    set({
      project: result.project,
      history: result.history,
      dirty: true,
      selectedClipIds: pruneSelection(state.selectedClipIds, result.project),
    });
  },

  redo() {
    const state = get();
    const result = history.redo(state.project, state.history);
    set({
      project: result.project,
      history: result.history,
      dirty: true,
      selectedClipIds: pruneSelection(state.selectedClipIds, result.project),
    });
  },

  selectClips(clipIds, additive = false) {
    set((state) => ({
      selectedClipIds: additive
        ? [...new Set([...state.selectedClipIds, ...clipIds])]
        : clipIds,
    }));
  },

  clearSelection() {
    set({ selectedClipIds: [] });
  },

  setTool(tool) {
    set({ tool });
  },

  toggleSnap() {
    set((state) => ({ snapEnabled: !state.snapEnabled }));
  },

  copySelection() {
    const clips = get().selectedClips();
    set({ clipboard: clips.map((clip) => structuredClone(clip)) });
  },

  cutSelection() {
    const state = get();
    const clips = state.selectedClips();
    if (clips.length === 0) return;
    set({ clipboard: clips.map((clip) => structuredClone(clip)) });
    state.updateSequence(
      (sequence) => engine.deleteClips(sequence, clips.map((clip) => clip.id)),
      "Cut",
    );
    set({ selectedClipIds: [] });
  },

  pasteClipboard(atTime, trackId) {
    const state = get();
    if (state.clipboard.length === 0) return;

    const earliest = Math.min(...state.clipboard.map((clip) => clip.startTime));
    const pasted = state.clipboard.map((clip) => ({
      ...structuredClone(clip),
      id: createId("clip"),
      trackId: trackId ?? clip.trackId,
      startTime: atTime + (clip.startTime - earliest),
    }));

    state.updateSequence(
      (sequence) => pasted.reduce((seq, clip) => engine.insertClip(seq, clip), sequence),
      "Paste",
    );
    set({ selectedClipIds: pasted.map((clip) => clip.id) });
  },

  setPlayhead(time) {
    // The playhead is not an undoable edit, so it bypasses the command stack.
    set((state) => {
      const sequence = activeSequence(state.project);
      return {
        project: replaceSequence(state.project, {
          ...sequence,
          playhead: Math.max(0, time),
        }),
      };
    });
  },

  updateSequence(transform, label = "Edit") {
    get().dispatch(
      snapshotCommand({ label }, (project) =>
        replaceSequence(project, transform(activeSequence(project))),
      ),
    );
  },

  sequence() {
    return activeSequence(get().project);
  },

  mediaById(mediaId) {
    if (!mediaId) return undefined;
    return get().project.media.find((item) => item.id === mediaId);
  },

  selectedClips() {
    const state = get();
    const sequence = activeSequence(state.project);
    return sequence.clips.filter((clip) => state.selectedClipIds.includes(clip.id));
  },
}));

/** Drops ids that no longer exist after an undo/redo. */
function pruneSelection(selected: string[], project: Project): string[] {
  const sequence = activeSequence(project);
  const alive = new Set(sequence.clips.map((clip) => clip.id));
  return selected.filter((id) => alive.has(id));
}
