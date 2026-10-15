// Browsers let any website send "simple" POSTs (text/plain or multipart bodies) to 127.0.0.1
// without a CORS preflight. The response stays unreadable, but the action still runs: another
// site could edit portfolios or start screenshot reads. Actions refuse such requests here.

/**
 * A 403 response when `request` was sent by a page from another origin, else null. Uses the
 * browser's `Sec-Fetch-Site`, falling back to `Origin` vs. the request host. Requests without
 * either header (curl, scripts, tests) aren't from a web page and pass.
 */
export function crossSiteRejection(request: Request): Response | null {
  const site = request.headers.get("sec-fetch-site");
  const origin = request.headers.get("origin");
  let sameOrigin: boolean;
  if (site !== null) {
    // "none": typed URL or bookmark, not a page.
    sameOrigin = site === "same-origin" || site === "none";
  } else if (origin === null) {
    return null;
  } else {
    sameOrigin = URL.canParse(origin) && new URL(origin).host === new URL(request.url).host;
  }
  return sameOrigin
    ? null
    : Response.json(
        {
          ok: false,
          error: {
            code: "cross_site",
            message: "Refused: this request came from another website.",
          },
        },
        { status: 403 },
      );
}
