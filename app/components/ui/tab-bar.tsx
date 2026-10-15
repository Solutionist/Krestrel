import type { Icon } from "@phosphor-icons/react";
import type { KeyboardEvent } from "react";

export interface TabOption<T extends string> {
  value: T;
  label: string;
  Icon?: Icon;
  /** Shown after the label, e.g. how many rows the tab holds. */
  count?: number;
}

/**
 * Page-level tabs (ARIA tablist): click or ←/→/Home/End to switch. Pair with one
 * `role="tabpanel"` element whose id is `${id}-panel` and `aria-labelledby` is `${id}-tab-${value}`.
 */
export function TabBar<T extends string>({
  id,
  label,
  options,
  value,
  onChange,
}: {
  id: string;
  label: string;
  options: readonly TabOption<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = options.findIndex((option) => option.value === value);
    const last = options.length - 1;
    const next =
      event.key === "ArrowRight"
        ? index === last
          ? 0
          : index + 1
        : event.key === "ArrowLeft"
          ? index === 0
            ? last
            : index - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;
    const option = next === null ? undefined : options[next];
    if (!option) return;
    event.preventDefault();
    onChange(option.value);
    document.getElementById(`${id}-tab-${option.value}`)?.focus();
  }

  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className="flex items-end gap-1 border-b border-rule/60"
    >
      {options.map(({ value: option, label: text, Icon, count }) => {
        const active = option === value;
        return (
          <button
            key={option}
            type="button"
            role="tab"
            id={`${id}-tab-${option}`}
            aria-selected={active}
            aria-controls={`${id}-panel`}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(option)}
            className={`-mb-px inline-flex h-10 items-center gap-1.5 border-b-2 px-3 text-sm font-medium transition-colors duration-150 ${
              active
                ? "border-accent text-text"
                : "border-transparent text-muted hover:border-rule hover:text-text"
            }`}
          >
            {Icon && <Icon aria-hidden size={16} weight={active ? "duotone" : "regular"} />}
            {text}
            {count !== undefined && (
              <span
                className={`rounded-full px-1.5 py-px text-xs tabular-nums ${
                  active ? "bg-accent/15 text-accent" : "bg-subtle text-muted"
                }`}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
