# React Router 8 (framework mode) in Krestrel

Sources: reactrouter.com (Context7 `/websites/reactrouter`), changelog v8.0.0–v8.4.0.

## Baseline

- Scaffolded with `create-react-router@8.4.0` default template (`remix-run/react-router-templates/default`). Removed: welcome page, Google Fonts link. The template's npm-based Dockerfile was replaced by a Bun-install / Node-runtime one for local `docker compose` use (ADR 0007).
- Imports: everything from `react-router`; `HydratedRouter`/`RouterProvider` from `react-router/dom`. `react-router-dom` no longer exists.
- v8 defaults (former `future.v8_*` flags): middleware always on, `context` is a `RouterContextProvider`; `splitRouteModules: true`; raw `request` passed to loaders/actions; `meta` gets `loaderData` (no `data`).
- No `unstable_*` flags (e.g. `unstable_enableNodeReadableStream`) may be enabled.

## Route config

Routes are declared in `app/routes.ts` (no file-system routing package):

```ts
import { index, route, type RouteConfig } from "@react-router/dev/routes";
export default [
  index("routes/_index.tsx"),
  route("api/stream", "routes/api.stream.ts"), // Phase 2
] satisfies RouteConfig;
```

## Generated types

`bun run typecheck` runs `react-router typegen && tsc`. Each module imports its own types:

```tsx
import type { Route } from "./+types/_index";
export function loader({ request, params }: Route.LoaderArgs) { /* … */ }
export default function Dashboard({ loaderData }: Route.ComponentProps) { /* … */ }
```

`.react-router/` is generated and git-ignored.

## Resource routes

A module with a `loader`/`action` and **no default export** is a resource route. Return a `Response` for external consumers (curl, EventSource); return plain data/`data()` when consumed by fetchers/forms.

```ts
export function loader(_: Route.LoaderArgs) {
  return Response.json({ ok: true });
}
```

SSE: return `new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } })` and clean up on `request.signal` `abort` (ADR 0002).

## Server-only code

- Anything under `app/.server/` (or named `*.server.ts`) is excluded from the client graph; the build **fails** if client code imports it.
- Route modules themselves must not be `.server`/`.client`.
- Loaders/actions may import from `.server`; components may not.

## Entry files

Hidden by default. `bunx react-router reveal` writes `app/entry.server.tsx` / `app/entry.client.tsx`. Phase 2 reveals `entry.server.tsx` to start the MarketHub at module scope (ADR 0004). Apps with `@react-router/node`/`serve` use `renderToPipeableStream` by default.

## Errors

`root.tsx` exports `ErrorBoundary({ error }: Route.ErrorBoundaryProps)`; use `isRouteErrorResponse(error)` for thrown responses. Stack traces only when `import.meta.env.DEV`.

## Testing

`createRoutesStub` (from `react-router`) is for reusable components that use router hooks. Route modules typed with `Route.*` are tested by calling their `loader`/`action` with a `Request` (see `app/routes/api.alerts.test.ts`).
