import { afterEach, describe, expect, it, vi } from "vitest";

import { createStoredValue } from "./stored-value";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

const makeStore = () =>
  createStoredValue<string>(
    "test.stored-value",
    "light",
    (raw) => raw,
    (value) => value,
  );

describe("createStoredValue", () => {
  it("saves to localStorage", () => {
    const store = makeStore();
    store.set("dark");
    expect(localStorage.getItem("test.stored-value")).toBe("dark");
    expect(store.get()).toBe("dark");
  });

  it("keeps a setting in memory when storage refuses the write", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    const store = makeStore();
    store.set("dark");
    expect(store.get()).toBe("dark");
  });
});
