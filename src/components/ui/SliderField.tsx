interface SliderFieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  defaultValue?: number;
  onChange: (value: number) => void;
  onCommit?: () => void;
}

/** Slider + numeric readout. Double clicking the label resets to default. */
export function SliderField({
  label,
  value,
  min,
  max,
  step = 1,
  defaultValue,
  onChange,
  onCommit,
}: SliderFieldProps) {
  return (
    <div className="py-1">
      <div className="flex items-center justify-between">
        <span
          className="field-label cursor-pointer"
          title="ダブルクリックで初期値に戻す"
          onDoubleClick={() => {
            if (defaultValue !== undefined) onChange(defaultValue);
          }}
        >
          {label}
        </span>
        <span className="font-mono text-2xs text-text-secondary">
          {Math.round(value * 100) / 100}
        </span>
      </div>
      <input
        type="range"
        className="mt-1 h-1 w-full appearance-none rounded bg-border accent-accent"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        onPointerUp={onCommit}
      />
    </div>
  );
}
