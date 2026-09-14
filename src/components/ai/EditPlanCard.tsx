import type { EditPlan } from "@/types/ai";
import { useAIStore } from "@/store/aiStore";
import { useEditorStore } from "@/store/editorStore";
import { applyPendingPlan, rejectPendingPlan } from "@/services/aiService";
import { formatDuration } from "@/utils/time";
import { useState } from "react";

interface EditPlanCardProps {
  plan: EditPlan;
}

/** Apply / Reject / Edit Plan card (design doc section 61). */
export function EditPlanCard({ plan }: EditPlanCardProps) {
  const issues = useAIStore((state) => state.pendingIssues);
  const sequence = useEditorStore((state) => state.sequence());
  const [showPlan, setShowPlan] = useState(false);

  const applicable = plan.actions.length - issues.length;

  return (
    <div className="rounded border border-accent/60 bg-panel-alt p-2">
      <p className="text-xs text-text">{plan.summary}</p>

      <p className="mt-1 text-2xs text-text-muted">
        {applicable}件を適用
        {issues.length > 0 ? ` / ${issues.length}件は適用できません` : ""}
      </p>

      <div className="mt-2 flex gap-1">
        <button
          className="toolbar-button border-accent/60 bg-accent-muted text-accent disabled:opacity-40"
          disabled={applicable <= 0}
          onClick={applyPendingPlan}
        >
          Apply
        </button>
        <button className="toolbar-button" onClick={rejectPendingPlan}>
          Reject
        </button>
        <button className="toolbar-button" onClick={() => setShowPlan(!showPlan)}>
          Edit Plan
        </button>
      </div>

      {showPlan ? (
        <div className="mt-2 max-h-40 space-y-1 overflow-auto border-t border-border pt-2">
          {plan.actions.map((action, index) => {
            const issue = issues.find((entry) => entry.actionIndex === index);
            return (
              <div
                key={index}
                className="flex items-center justify-between gap-2 text-2xs"
              >
                <span className={issue ? "text-text-muted line-through" : "text-text-secondary"}>
                  {describeAction(action)}
                </span>
                {issue ? (
                  <span className="shrink-0 text-warning" title={issue.message}>
                    除外
                  </span>
                ) : null}
              </div>
            );
          })}
          <p className="pt-1 text-2xs text-text-muted">
            対象シーケンス: {sequence.name}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function describeAction(action: EditPlan["actions"][number]): string {
  switch (action.type) {
    case "delete":
      return `削除 ${formatDuration(action.start)}–${formatDuration(action.end)}${
        action.reason ? ` (${action.reason})` : ""
      }`;
    case "cut":
      return `分割 ${formatDuration(action.at)}`;
    case "move":
      return `移動 → ${formatDuration(action.startTime)}`;
    case "color":
      return `色調整 ${Object.entries(action.color)
        .map(([key, value]) => `${key} ${value}`)
        .join(", ")}`;
    case "volume":
      return `音量 ${action.volume}dB`;
    case "speed":
      return `速度 ${action.speed}×`;
  }
}
