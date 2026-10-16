import { crossSiteRejection } from "./same-origin";

/**
 * App-wide request guard, run by the root route middleware.
 *
 * DNS rebinding: a hostile page can point its own hostname at 127.0.0.1, so the
 * browser treats it as same-origin. react-router-serve has no Host check (Vite
 * dev does), so any Host other than a loopback name gets 421.
 *
 * Every `/api/*` request, GET included, is refused when it comes from another
 * site: some GETs have side effects (`/api/performance` downloads and stores
 * bars; dividends and FX history call upstream). Document navigations from
 * other sites stay allowed.
 */
const LOOPBACK_HOSTNAMES: Record<string, true> = {
  "127.0.0.1": true,
  localhost: true,
  "[::1]": true,
};

export function requestGuard(request: Request): Response | null {
  const url = new URL(request.url);
  if (!Object.hasOwn(LOOPBACK_HOSTNAMES, url.hostname)) {
    return new Response("Misdirected Request: Krestrel only answers on 127.0.0.1 or localhost.", {
      status: 421,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  if (url.pathname.startsWith("/api/")) return crossSiteRejection(request);
  return null;
}
