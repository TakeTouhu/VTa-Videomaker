import { useEditorStore } from "@/store/editorStore";
import { useUIStore } from "@/store/uiStore";
import { sequenceDuration } from "@/features/timeline/engine";
import { formatTimecode } from "@/utils/time";

/** Status bar: sequence info, playhead, background jobs. */
export function StatusBar() {
  const sequence = useEditorStore((state) => state.sequence());
  const clipCount = sequence.clips.length;
  const jobs = useUIStore((state) => state.jobs);
  const statusMessage = useUIStore((state) => state.statusMessage);
  const activeJobs = jobs.filter((job) => job.status === "running");

  return (
    <footer className="flex h-6 shrink-0 items-center gap-4 border-t border-border bg-panel px-3 text-2xs text-text-secondary">
      <span className="font-mono">{formatTimecode(sequence.playhead, sequence.fps)}</span>
      <span>
        {sequence.width}×{sequence.height} · {sequence.fps}fps
      </span>
      <span>{clipCount} clips</span>
      <span className="font-mono">
        Duration {formatTimecode(sequenceDuration(sequence), sequence.fps)}
      </span>

      <div className="flex-1" />

      {activeJobs.map((job) => (
        <span key={job.id} className="flex items-center gap-2">
          <span>{job.label}</span>
          <span className="h-1 w-24 overflow-hidden rounded bg-border">
            <span
              className="block h-full bg-accent transition-[width]"
              style={{ width: `${Math.round(job.progress * 100)}%` }}
            />
          </span>
          <span className="font-mono">{Math.round(job.progress * 100)}%</span>
        </span>
      ))}

      {statusMessage ? <span className="text-text">{statusMessage}</span> : null}
    </footer>
  );
}
