/** App settings that live outside the project file (API keys, engines). */

import { create } from "zustand";
import type { AIProviderConfig } from "@/types/ai";

export interface SpeechEngineSettings {
  binary: string;
  model: string;
  language: string;
}

export interface AppSettings {
  speech: SpeechEngineSettings;
  aiProvider: AIProviderConfig["provider"];
  aiModel: string;
  aiEndpoint: string;
  /** Masked when loaded back from disk; never written into project.json. */
  aiApiKey: string;
  detectorBinary: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  speech: { binary: "", model: "", language: "auto" },
  aiProvider: "local",
  aiModel: "",
  aiEndpoint: "",
  aiApiKey: "",
  detectorBinary: "",
};

export interface SettingsState {
  settings: AppSettings;
  loaded: boolean;
  dialogOpen: boolean;

  setSettings(settings: Partial<AppSettings>): void;
  setLoaded(loaded: boolean): void;
  setDialogOpen(open: boolean): void;
  providerConfig(): AIProviderConfig;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  dialogOpen: false,

  setSettings: (patch) =>
    set((state) => ({ settings: { ...state.settings, ...patch } })),
  setLoaded: (loaded) => set({ loaded }),
  setDialogOpen: (dialogOpen) => set({ dialogOpen }),

  providerConfig() {
    const { settings } = get();
    return {
      provider: settings.aiProvider,
      model: settings.aiModel || undefined,
      endpoint: settings.aiEndpoint || undefined,
      apiKey: settings.aiApiKey || undefined,
    };
  },
}));
