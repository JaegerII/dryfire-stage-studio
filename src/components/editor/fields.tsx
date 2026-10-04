import type { ReactNode } from 'react';

/** Small form controls for the properties panel. */

export const Row = ({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) => (
  <label className="row" title={hint}>
    <span className="row-label">{label}</span>
    <span className="row-control">{children}</span>
  </label>
);

export const NumberField = ({
  value,
  onChange,
  step = 0.01,
  min,
  max,
  disabled,
  digits = 3,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  disabled?: boolean;
  digits?: number;
}) => (
  <input
    type="number"
    value={Number.isFinite(value) ? +value.toFixed(digits) : ''}
    step={step}
    min={min}
    max={max}
    disabled={disabled}
    onChange={(e) => {
      const v = parseFloat(e.target.value);
      if (Number.isFinite(v)) onChange(min !== undefined || max !== undefined ? Math.min(max ?? v, Math.max(min ?? v, v)) : v);
    }}
  />
);

export const SliderField = ({
  value,
  onChange,
  min,
  max,
  step,
  disabled,
  digits = 2,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  digits?: number;
}) => (
  <span className="slider">
    <input type="range" value={value} min={min} max={max} step={step} disabled={disabled} onChange={(e) => onChange(parseFloat(e.target.value))} />
    <NumberField value={value} onChange={onChange} min={min} max={max} step={step} disabled={disabled} digits={digits} />
  </span>
);

export const Select = <T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) => (
  <select value={value} onChange={(e) => onChange(e.target.value as T)}>
    {options.map((o) => (
      <option key={o.value} value={o.value}>
        {o.label}
      </option>
    ))}
  </select>
);
