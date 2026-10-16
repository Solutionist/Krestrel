import { useEffect, useState } from "react";

import { createStoredValue } from "./stored-value";

export const THEME_PREFERENCES = ["system", "light", "dark"] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

const STORAGE_KEY = "krestrel.theme";

/** Light, dark navy, or follow the OS (ADR 0015). */
export const themePreference = createStoredValue<ThemePreference>(
  STORAGE_KEY,
  "system",
  (raw) => THEME_PREFERENCES.find((value) => value === raw) ?? null,
  (value) => value,
);

/**
 * Inline script for <head>: sets html[data-theme] before first paint so a dark-mode visitor never
 * sees a light flash. Mirrors `resolveTheme`; keep the two in step. The storage key is written out
 * literally (it must equal STORAGE_KEY) so no value is ever spliced into script source.
 */
export const THEME_SCRIPT = `(()=>{try{var p=localStorage.getItem("krestrel.theme");var d=p==="dark"||(p!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.dataset.theme=d?"dark":"light"}catch(e){}})()`;

const DARK_QUERY = "(prefers-color-scheme: dark)";

function resolveTheme(preference: ThemePreference): "light" | "dark" {
  if (preference !== "system") return preference;
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

/**
 * Keeps html[data-theme] in step with the saved preference and, for "system", the OS setting.
 * Mounted once, in the root route. Switching cross-fades colours briefly (not under reduced motion).
 */
export function useApplyTheme(): void {
  const [preference] = themePreference.use();
  // biome-ignore lint/correctness/useExhaustiveDependencies: `preference` is the re-apply trigger; `apply` reads the store itself.
  useEffect(() => {
    const root = document.documentElement;
    let fade = 0;
    const apply = () => {
      // Read the store, not the render value: during hydration `preference` is still the
      // server fallback, and applying it would flip the theme set by THEME_SCRIPT.
      const next = resolveTheme(themePreference.get());
      if (root.dataset.theme === next) return;
      root.classList.add("theme-transition");
      root.dataset.theme = next;
      clearTimeout(fade);
      fade = window.setTimeout(() => root.classList.remove("theme-transition"), 250);
    };
    apply();
    const media = window.matchMedia(DARK_QUERY);
    media.addEventListener("change", apply);
    return () => {
      media.removeEventListener("change", apply);
      clearTimeout(fade);
    };
  }, [preference]);
}

/**
 * Counts theme changes after mount (0 on the server and first render). Canvas-drawn views such as
 * the chart key on it to redraw in the new colours; the initial theme never causes a remount.
 */
export function useThemeVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const observer = new MutationObserver(() => setVersion((current) => current + 1));
    observer.observe(document.documentElement, { attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  return version;
}
