import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

const BASE =
  "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap font-medium transition-[background-color,color,box-shadow,transform,opacity] duration-150 active:translate-y-px disabled:pointer-events-none disabled:opacity-45";

const VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-accent text-white shadow-sm shadow-accent/25 hover:bg-accent/90",
  secondary: "bg-panel text-text ring-1 ring-inset ring-rule hover:bg-subtle",
  ghost: "text-muted hover:bg-subtle hover:text-text",
  danger: "text-muted hover:bg-fall/10 hover:text-fall",
};

const SIZE: Record<ButtonSize, string> = {
  sm: "h-7 rounded-md px-2.5 text-xs",
  md: "h-9 rounded-lg px-3.5 text-sm",
};

const ICON_SIZE: Record<ButtonSize, string> = {
  sm: "size-7 rounded-md",
  md: "size-9 rounded-lg",
};

/** Text button. `primary` for the one main action in a view; `ghost` for the rest. */
export function Button({
  variant = "secondary",
  size = "md",
  className = "",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return (
    <button
      type={type}
      className={`${BASE} ${VARIANT[variant]} ${SIZE[size]} ${className}`}
      {...props}
    />
  );
}

/** Square icon-only button; `label` is its accessible name and tooltip. */
export function IconButton({
  label,
  children,
  variant = "ghost",
  size = "sm",
  className = "",
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "type"> & {
  label: string;
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`${BASE} ${VARIANT[variant]} ${ICON_SIZE[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

/**
 * On/off chip for view toggles (overlays, panels). Pressed = accent tint, so state reads at a
 * glance without relying on colour alone (aria-pressed for assistive tech).
 */
export function ToggleChip({
  pressed,
  className = "",
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "aria-pressed"> & { pressed: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      className={`${BASE} h-7 rounded-md px-2.5 text-xs ${
        pressed
          ? "bg-accent/12 text-accent ring-1 ring-inset ring-accent/25"
          : "text-muted hover:bg-subtle hover:text-text"
      } ${className}`}
      {...props}
    />
  );
}
