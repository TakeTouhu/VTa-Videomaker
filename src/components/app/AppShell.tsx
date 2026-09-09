import { MediaPanel } from "@/components/media/MediaPanel";
import { PreviewPanel } from "@/components/preview/PreviewPanel";
import { InspectorPanel } from "@/components/inspector/InspectorPanel";
import { TimelinePanel } from "@/components/timeline/TimelinePanel";
import { AIAssistantPanel } from "@/components/ai/AIAssistantPanel";
import { ExportDialog } from "@/components/export/ExportDialog";
import { TopBar } from "./TopBar";
import { StatusBar } from "./StatusBar";
import { ErrorToasts } from "./ErrorToasts";
import { useUIStore } from "@/store/uiStore";

/** Workspace layout (design doc section 7). */
export function AppShell() {
  const aiPanelOpen = useUIStore((state) => state.aiPanelOpen);
  const exportDialogOpen = useUIStore((state) => state.exportDialogOpen);

  return (
    <div className="flex h-full w-full flex-col bg-bg">
      <TopBar />

      <div className="flex min-h-0 flex-1 flex-col gap-px p-px">
        {/* Upper row: media / preview / inspector */}
        <div className="flex min-h-0 flex-[3] gap-px">
          <MediaPanel className="w-[280px] shrink-0" />
          <PreviewPanel className="flex-1" />
          <InspectorPanel className="w-[300px] shrink-0" />
        </div>

        {/* Lower row: timeline, with the AI assistant docked at its right */}
        <div className="flex min-h-0 flex-[2] gap-px">
          <TimelinePanel className="flex-1" />
          {aiPanelOpen ? <AIAssistantPanel className="w-[320px] shrink-0" /> : null}
        </div>
      </div>

      <StatusBar />
      <ErrorToasts />
      {exportDialogOpen ? <ExportDialog /> : null}
    </div>
  );
}
