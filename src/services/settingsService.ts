/** Loads and saves app settings, and registers the configured AI provider. */

import { backend, isTauri } from "./backend";
import { DEFAULT_SETTINGS, useSettingsStore } from "@/store/settingsStore";
import type { AppSettings } from "@/store/settingsStore";
import { registerProvider } from "@/features/ai/provider";
import { createLocalProvider } from "@/features/ai/providers/local";
import { createOpenAIProvider } from "@/features/ai/providers/openai";
import { useUIStore } from "@/store/uiStore";
import { appError } from "@/types/errors";

export async function loadSettings(): Promise<void> {
  const store = useSettingsStore.getState();
  try {
    const loaded = isTauri() ? await backend().loadSettings() : DEFAULT_SETTINGS;
    store.setSettings(loaded);
  } catch {
    // Settings are best-effort; defaults keep the app usable.
    store.setSettings(DEFAULT_SETTINGS);
  } finally {
    store.setLoaded(true);
    registerConfiguredProviders();
  }
}

export async function saveSettings(patch: Partial<AppSettings>): Promise<void> {
  const store = useSettingsStore.getState();
  store.setSettings(patch);
  try {
    await backend().saveSettings(useSettingsStore.getState().settings);
    registerConfiguredProviders();
    useUIStore.getState().setStatus("設定を保存しました");
  } catch (error) {
    useUIStore
      .getState()
      .pushError(appError("unknown", "設定を保存できませんでした", String(error)));
  }
}

/**
 * Registers a provider instance for each backend the user could select, so
 * switching providers in settings takes effect without a restart.
 */
export function registerConfiguredProviders(): void {
  const config = useSettingsStore.getState().providerConfig();
  registerProvider(createLocalProvider());
  registerProvider(createOpenAIProvider(config));
}

/**
 * The stored key is masked in the UI, so the real one is fetched from the Rust
 * core only when a request is about to be made.
 */
export async function resolveApiKey(): Promise<string | undefined> {
  if (!isTauri()) return undefined;
  try {
    const key = await backend().resolveApiKey();
    return key || undefined;
  } catch {
    return undefined;
  }
}
