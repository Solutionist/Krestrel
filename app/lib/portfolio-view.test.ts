import { describe, expect, it } from "vitest";

import { onlyViewChanged } from "./portfolio-view";

const url = (path: string) => new URL(path, "http://127.0.0.1:5173");

describe("onlyViewChanged (when the portfolio page may skip reloading its data)", () => {
  it("is true for a tab switch, in either direction", () => {
    expect(onlyViewChanged(url("/portfolio"), url("/portfolio?view=trades"))).toBe(true);
    expect(onlyViewChanged(url("/portfolio?p=1&view=trades"), url("/portfolio?p=1"))).toBe(true);
  });

  it("is false for the same URL again, so clicking Portfolio refreshes the data", () => {
    expect(onlyViewChanged(url("/portfolio"), url("/portfolio"))).toBe(false);
    expect(onlyViewChanged(url("/portfolio?view=trades"), url("/portfolio?view=trades"))).toBe(
      false,
    );
  });

  it("is false when the portfolio or the page changes", () => {
    expect(onlyViewChanged(url("/portfolio?p=1"), url("/portfolio?p=2&view=trades"))).toBe(false);
    expect(onlyViewChanged(url("/portfolio"), url("/ideas"))).toBe(false);
  });
});
