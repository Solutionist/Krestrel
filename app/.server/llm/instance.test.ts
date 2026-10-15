import { afterEach, describe, expect, it, vi } from "vitest";
import * as z from "zod";

import { ConfigError } from "../env-schema";
import { aiFailureResponse, getAi } from "./instance";
import { LlmError } from "./types";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getAi", () => {
  it("turns every AI feature off with LLM_PROVIDER=none, local models included", async () => {
    vi.stubEnv("LLM_PROVIDER", "none");
    for (const llm of [
      getAi({ provider: "claude", model: "default" }),
      getAi({ provider: "local", model: null }),
    ]) {
      expect(llm.id).toBe("none");
      const error = await llm
        .generateStructured({ system: "", prompt: "", schema: z.object({}) })
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(LlmError);
      expect(error).toMatchObject({ code: "disabled" });
    }
  });

  it("routes a local choice to Ollama with the chosen model, and Claude to the CLI", () => {
    vi.stubEnv("LLM_PROVIDER", "claude-cli");
    vi.stubEnv("OLLAMA_MODEL", "llama3.2");
    const local = getAi({ provider: "local", model: null });
    expect(local.id).toBe("ollama");
    expect(local.displayName).toContain("llama3.2");
    expect(local.capabilities.webSearch).toBe(false);
    const claude = getAi({ provider: "claude", model: "default" });
    expect(claude.id).toBe("claude-cli");
    expect(claude.capabilities.webSearch).toBe(true);
  });
});

describe("aiFailureResponse", () => {
  it("answers expected AI failures with their status and a safe message", async () => {
    const busy = aiFailureResponse(new LlmError("busy", "Claude is already working."));
    expect(busy?.status).toBe(429);
    await expect(busy?.json()).resolves.toEqual({
      ok: false,
      error: { code: "busy", message: "Claude is already working." },
    });
    const missing = aiFailureResponse(new LlmError("model_missing", "Download it."));
    expect(missing?.status).toBe(503);
  });

  it("reports bad AI settings in .env as a config problem", async () => {
    const response = aiFailureResponse(new ConfigError("Invalid Ollama configuration"));
    expect(response?.status).toBe(503);
    await expect(response?.json()).resolves.toMatchObject({ error: { code: "config" } });
  });

  it("leaves unexpected errors to the caller", () => {
    expect(aiFailureResponse(new Error("boom"))).toBeNull();
    expect(aiFailureResponse("boom")).toBeNull();
  });
});
