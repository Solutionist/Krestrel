import type { ReactNode } from "react";

/**
 * Page frame shared by every route: top bar, optional status banner, then a sidebar card and a
 * main card floating on the canvas (ADR 0015). Callers render the <aside>/<main> themselves with
 * the CARD recipe so each keeps its own landmark and label.
 */
export function AppShell({
  header,
  banner,
  sidebar,
  children,
}: {
  header: ReactNode;
  banner?: ReactNode;
  sidebar: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex h-dvh flex-col bg-ink">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-panel focus:px-3 focus:py-2 focus:shadow-pop"
      >
        Skip to content
      </a>
      {header}
      {banner}
      <div className="grid min-h-0 flex-1 grid-cols-[16.5rem_minmax(0,1fr)] gap-3 px-3 pb-3 lg:grid-cols-[18.5rem_minmax(0,1fr)]">
        {sidebar}
        {children}
      </div>
    </div>
  );
}
