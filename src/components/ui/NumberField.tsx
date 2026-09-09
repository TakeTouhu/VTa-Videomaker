import { useEffect, useState } from "react";

interface NumberFieldProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  disabled?: boolean;
}

/** Labelled numeric input that only commits parseable values. */
export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  unit,
  disabled,
}: NumberFieldProps) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(round(value)));
  }, [value]);

  const commit = () => {
    const parsed = Number(draft);
    if (!Number.isFinite(parsed)) {
      setDraft(String(round(value)));
      return;
    }
    const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, parsed));
    onChange(clamped);
    setDraft(String(round(clamped)));
  };

  return (
    <label className="flex items-center justify-between gap-2 py-0.5">
      <span className="field-label truncate">{label}</span>
      <span className="flex items-center gap-1">
        <input
          className="num-input w-20"
          value={draft}
          disabled={disabled}
          step={step}
          type="number"
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
        {unit ? <span className="w-4 text-2xs text-text-muted">{unit}</span> : null}
      </span>
    </label>
  );
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
