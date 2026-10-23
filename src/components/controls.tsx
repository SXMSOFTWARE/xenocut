import type { CSSProperties, ReactNode } from "react";

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
  onStart?: () => void;
  onEnd?: () => void;
  disabled?: boolean;
}

export function Slider({ label, value, min, max, step = 0.01, format, onChange, onStart, onEnd, disabled }: SliderProps) {
  const fill = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <div className="slider">
      <div className="slider-head">
        <span>{label}</span>
        <b>{format ? format(value) : value.toFixed(2)}</b>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        style={{ "--fill": `${fill}%` } as CSSProperties}
        onPointerDown={onStart}
        onPointerUp={onEnd}
        onKeyDown={onStart}
        onKeyUp={onEnd}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
      />
    </div>
  );
}

export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button className={`switch${on ? " on" : ""}`} role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} />;
}

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={String(o.value)} className={o.value === value ? "active" : ""} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
