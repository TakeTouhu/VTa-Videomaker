/** Loads app settings once at startup and registers the AI providers. */

import { useEffect } from "react";
import { loadSettings } from "@/services/settingsService";

export function useSettingsBootstrap(): void {
  useEffect(() => {
    void loadSettings();
  }, []);
}
