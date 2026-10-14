import type { ReactNode } from "react";

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  /** Accessible name when `label` is an icon or abbreviation. */
  ariaLabel?: string;
  title?: string;
}

/**
 * A row of mutually exclusive choices on a recessed track; the chosen one lifts onto a card
 * surface. `value: null` shows none chosen (e.g. a range preset after a manual zoom). Optional
 * `dividers` start a new visual group before the given values.
 */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  dividers = [],
  className = "",
}: {
  label: string;
  options: readonly SegmentedOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
  dividers?: readonly T[];
  className?: string;
}) {
  return (
    <fieldset
      className={`inline-flex items-center gap-0.5 rounded-lg bg-subtle p-0.5 ${className}`}
    >
      <legend className="sr-only">{label}</legend>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <span key={option.value} className="flex items-center">
            {dividers.includes(option.value) && (
              <span aria-hidden className="mx-0.5 h-3.5 w-px bg-rule" />
            )}
            <button
              type="button"
              aria-pressed={active}
              aria-label={option.ariaLabel}
              title={option.title ?? option.ariaLabel}
              onClick={() => onChange(option.value)}
              className={`inline-flex h-7 min-w-7 items-center justify-center gap-1 rounded-md px-2 text-xs font-medium tabular-nums transition-[background-color,color,box-shadow] duration-150 ${
                active
                  ? "bg-panel text-text shadow-sm ring-1 ring-rule/80"
                  : "text-muted hover:text-text"
              }`}
            >
              {option.label}
            </button>
          </span>
        );
      })}
    </fieldset>
  );
}
