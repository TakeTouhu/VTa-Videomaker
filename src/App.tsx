import { AppShell } from "@/components/app/AppShell";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useAutosave } from "@/hooks/useAutosave";
import { useJobUpdates } from "@/hooks/useJobUpdates";

export default function App() {
  useKeyboardShortcuts();
  useAutosave();
  useJobUpdates();
  return <AppShell />;
}
