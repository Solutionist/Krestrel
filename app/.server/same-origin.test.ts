import { describe, expect, it } from "vitest";

import { crossSiteRejection } from "./same-origin";

const URL_ = "http://127.0.0.1:5173/api/portfolios";
const post = (headers: Record<string, string>) => new Request(URL_, { method: "POST", headers });

describe("crossSiteRejection", () => {
  it("refuses a no-preflight POST sent by a page on another origin", async () => {
    const refused = crossSiteRejection(
      post({ "sec-fetch-site": "cross-site", origin: "http://localhost:5174" }),
    );
    expect(refused?.status).toBe(403);
    expect(await refused?.json()).toMatchObject({ ok: false, error: { code: "cross_site" } });
    // Another port on this machine is "same-site" to the browser, but still another origin.
    expect(crossSiteRejection(post({ "sec-fetch-site": "same-site" }))?.status).toBe(403);
  });

  it("falls back to Origin vs. host when the browser sends no Sec-Fetch-Site", () => {
    expect(crossSiteRejection(post({ origin: "http://evil.example" }))?.status).toBe(403);
    expect(crossSiteRejection(post({ origin: "null" }))?.status).toBe(403);
    expect(crossSiteRejection(post({ origin: "http://127.0.0.1:5173" }))).toBeNull();
  });

  it("lets the app's own pages and non-browser clients through", () => {
    expect(crossSiteRejection(post({ "sec-fetch-site": "same-origin" }))).toBeNull();
    expect(crossSiteRejection(post({}))).toBeNull();
  });
});
