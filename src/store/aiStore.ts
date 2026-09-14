/** AI Assistant conversation, pending edit plan and applied-edit history. */

import { create } from "zustand";
import type {
  AIHistoryEntry,
  ChatMessage,
  EditPlan,
  MediaAnalysis,
} from "@/types/ai";
import type { ValidationIssue } from "@/features/ai/validation";
import { createId } from "@/utils/id";

export type AIEditMode = "auto" | "assistant" | "manual";

export interface AIState {
  mode: AIEditMode;
  busy: boolean;
  messages: ChatMessage[];
  /** The plan awaiting Apply / Reject (design doc section 61). */
  pendingPlan: EditPlan | null;
  pendingIssues: ValidationIssue[];
  entries: AIHistoryEntry[];
  analyses: Record<string, MediaAnalysis>;

  setMode(mode: AIEditMode): void;
  setBusy(busy: boolean): void;
  addMessage(role: ChatMessage["role"], content: string, planId?: string): ChatMessage;
  setPendingPlan(plan: EditPlan | null, issues?: ValidationIssue[]): void;
  recordApplied(entry: AIHistoryEntry): void;
  setAnalysis(analysis: MediaAnalysis): void;
  reset(): void;
}

export const useAIStore = create<AIState>((set) => ({
  mode: "assistant",
  busy: false,
  messages: [],
  pendingPlan: null,
  pendingIssues: [],
  entries: [],
  analyses: {},

  setMode: (mode) => set({ mode }),
  setBusy: (busy) => set({ busy }),

  addMessage(role, content, planId) {
    const message: ChatMessage = {
      id: createId("msg"),
      role,
      content,
      createdAt: new Date().toISOString(),
      planId,
    };
    set((state) => ({ messages: [...state.messages, message] }));
    return message;
  },

  setPendingPlan: (pendingPlan, pendingIssues = []) =>
    set({ pendingPlan, pendingIssues }),

  recordApplied: (entry) => set((state) => ({ entries: [...state.entries, entry] })),

  setAnalysis: (analysis) =>
    set((state) => ({
      analyses: { ...state.analyses, [analysis.mediaId]: analysis },
    })),

  reset: () =>
    set({ messages: [], pendingPlan: null, pendingIssues: [], entries: [] }),
}));
