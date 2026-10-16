import { describe, expect, it } from "vitest";

import { requestGuard } from "./request-guard";

describe("requestGuard", () => {
  it("answers 421 for a non-loopback Host", () => {
    const response = requestGuard(new Request("http://evil.example:3000/api/health"));
    expect(response?.status).toBe(421);
  });

  it("refuses a cross-site API GET", async () => {
    const response = requestGuard(
      new Request("http://127.0.0.1:3000/api/performance", {
        headers: { "sec-fetch-site": "cross-site" },
      }),
    );
    expect(response?.status).toBe(403);
    expect(await response?.json()).toMatchObject({ error: { code: "cross_site" } });
  });

  it("lets a same-origin API GET through", () => {
    const request = new Request("http://127.0.0.1:3000/api/performance", {
      headers: { "sec-fetch-site": "same-origin" },
    });
    expect(requestGuard(request)).toBeNull();
  });

  it("lets a cross-site document navigation through", () => {
    const request = new Request("http://localhost:5173/", {
      headers: { "sec-fetch-site": "cross-site" },
    });
    expect(requestGuard(request)).toBeNull();
  });

  it("lets a header-less client reach the API over IPv6 loopback", () => {
    expect(requestGuard(new Request("http://[::1]:3000/api/health"))).toBeNull();
  });
});
