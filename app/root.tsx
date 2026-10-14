import "@fontsource-variable/geist/index.css";
import "@fontsource-variable/geist-mono/index.css";
import "./app.css";

import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";

import { THEME_SCRIPT, useApplyTheme } from "~/hooks/use-theme";

import type { Route } from "./+types/root";

export const links: Route.LinksFunction = () => [
  { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    // data-theme is set by THEME_SCRIPT before hydration, so the server markup can't match it.
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light dark" />
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: static, app-owned script (no user input) that must run before first paint. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  useApplyTheme();
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Something went wrong";
  let details = "An unexpected error occurred. Reload the page to try again.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "Page not found" : `Error ${error.status}`;
    details =
      error.status === 404
        ? "There is nothing at this address. Go back to the dashboard."
        : error.statusText || details;
  } else if (import.meta.env.DEV && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-ink p-6">
      <div className="w-full max-w-lg rounded-2xl bg-panel p-8 shadow-card ring-1 ring-rule/70">
        <span
          aria-hidden
          className="grid size-9 place-items-center rounded-xl bg-accent text-sm font-semibold text-white"
        >
          K
        </span>
        <h1 className="mt-5 text-lg font-semibold tracking-tight text-text">{message}</h1>
        <p className="mt-1.5 text-sm text-muted">{details}</p>
        <a
          href="/"
          className="mt-6 inline-flex h-9 items-center rounded-lg bg-accent px-3.5 text-sm font-medium text-white shadow-sm shadow-accent/25 transition-colors duration-150 hover:bg-accent/90"
        >
          Back to Markets
        </a>
        {stack && (
          <pre className="mt-6 overflow-x-auto rounded-xl bg-subtle p-4 font-mono text-xs text-muted">
            <code>{stack}</code>
          </pre>
        )}
      </div>
    </main>
  );
}
