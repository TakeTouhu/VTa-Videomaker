import { useState } from "react";
import { useUIStore } from "@/store/uiStore";

/** User-facing errors. Technical detail stays collapsed (design doc section 49). */
export function ErrorToasts() {
  const errors = useUIStore((state) => state.errors);
  const dismissError = useUIStore((state) => state.dismissError);
  const [expanded, setExpanded] = useState<number | null>(null);

  if (errors.length === 0) return null;

  return (
    <div className="pointer-events-none absolute bottom-8 right-3 z-50 flex w-96 flex-col gap-2">
      {errors.map((error, index) => (
        <div
          key={`${error.kind}-${index}`}
          className="pointer-events-auto rounded border border-danger/60 bg-panel p-3 shadow-lg"
        >
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs text-text">{error.message}</p>
            <button
              className="text-2xs text-text-muted hover:text-text"
              onClick={() => dismissError(index)}
            >
              閉じる
            </button>
          </div>
          {error.detail ? (
            <>
              <button
                className="mt-1 text-2xs text-text-muted underline"
                onClick={() => setExpanded(expanded === index ? null : index)}
              >
                詳細
              </button>
              {expanded === index ? (
                <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-all rounded bg-bg p-2 font-mono text-2xs text-text-muted">
                  {error.detail}
                </pre>
              ) : null}
            </>
          ) : null}
        </div>
      ))}
    </div>
  );
}
