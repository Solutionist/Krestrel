import { pino } from "pino";
import { describe, expect, it, vi } from "vitest";
import * as z from "zod";

import { ConfigError } from "../env-schema";
import { createOllamaClient, ollamaConfig } from "./ollama";
import { LlmError } from "./types";

const logger = pino({ level: "silent" });
const Schema = z.object({ answer: z.number() });
const request = { system: "sys", prompt: "data", schema: Schema };

function answer(content: unknown): typeof fetch {
  return vi.fn<typeof fetch>(async () =>
    Response.json({ message: { role: "assistant", content: JSON.stringify(content) } }),
  );
}

function client(send: typeof fetch, env: Record<string, string> = {}, model: string | null = null) {
  return createOllamaClient({ env, logger, fetch: send }, model);
}

async function errorOf(promise: Promise<unknown>): Promise<LlmError> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  if (!(error instanceof LlmError)) throw new Error(`expected LlmError, got ${String(error)}`);
  return error;
}

describe("ollamaConfig", () => {
  it("accepts only loopback URLs, so prompts and screenshots can't leave this machine", () => {
    for (const url of ["http://127.0.0.1:11434", "http://localhost:11434", "http://[::1]:11434"]) {
      expect(ollamaConfig({ OLLAMA_URL: url }).OLLAMA_URL).toBe(url);
    }
    for (const url of [
      "http://192.168.1.20:11434",
      "http://ollama.example.com",
      "ftp://127.0.0.1",
    ]) {
      expect(() => ollamaConfig({ OLLAMA_URL: url })).toThrow(ConfigError);
    }
  });

  it("refuses to build a client for a remote Ollama", () => {
    const fetch = answer({ answer: 1 });
    expect(() => client(fetch, { OLLAMA_URL: "http://10.0.0.5:11434" })).toThrow(ConfigError);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("Ollama client", () => {
  it("asks for schema-constrained JSON and returns the validated answer with the model", async () => {
    const fetch = answer({ answer: 42 });
    await expect(client(fetch).generateStructured(request)).resolves.toEqual({
      data: { answer: 42 },
      model: "qwen3-vl:8b-instruct",
    });
    const [url, init] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(String(url)).toBe("http://127.0.0.1:11434/api/chat");
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({ model: "qwen3-vl:8b-instruct", stream: false });
    expect(body.format).toMatchObject({ type: "object", required: ["answer"] });
    expect(body.format).not.toHaveProperty("$schema");
    expect(body.messages).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "data" },
    ]);
  });

  it("uses the chosen model over OLLAMA_MODEL and sends images as base64", async () => {
    const fetch = answer({ answer: 1 });
    const image = new Uint8Array([137, 80, 78, 71]);
    const llm = client(fetch, { OLLAMA_MODEL: "llama3.2" }, "gemma3:4b");
    await expect(llm.generateStructured({ ...request, images: [image] })).resolves.toMatchObject({
      model: "gemma3:4b",
    });
    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body));
    expect(body.model).toBe("gemma3:4b");
    expect(body.messages.at(-1).images).toEqual([Buffer.from(image).toString("base64")]);
  });

  it("can't search the web itself", () => {
    expect(client(answer({})).capabilities.webSearch).toBe(false);
  });

  it("explains how to set up Ollama when it isn't running or the model isn't pulled", async () => {
    const refused = vi.fn<typeof fetch>(async () => {
      throw new TypeError("fetch failed");
    });
    const down = await errorOf(client(refused).generateStructured(request));
    expect(down.code).toBe("unavailable");
    expect(down.message).toMatch(/ollama pull qwen3-vl:8b-instruct/);

    const missing = vi.fn<typeof fetch>(async () =>
      Response.json({ error: "model 'qwen3-vl:8b-instruct' not found" }, { status: 404 }),
    );
    expect((await errorOf(client(missing).generateStructured(request))).code).toBe("model_missing");
  });

  it("reports a timeout instead of 'not running' when the model is just slow", async () => {
    const slow = vi.fn<typeof fetch>(async () => {
      throw new DOMException("The operation timed out.", "TimeoutError");
    });
    expect((await errorOf(client(slow).generateStructured(request))).code).toBe("timeout");
  });

  it("says the model can't read images when Ollama rejects them", async () => {
    const textOnly = vi.fn<typeof fetch>(async () =>
      Response.json(
        { error: "this model is missing data required for image input" },
        { status: 500 },
      ),
    );
    const error = await errorOf(
      client(textOnly).generateStructured({ ...request, images: [new Uint8Array([1])] }),
    );
    expect(error.code).toBe("unsupported");
  });

  it("maps other HTTP failures to a plain error, even without a JSON body", async () => {
    const broken = vi.fn<typeof fetch>(async () => new Response("oops", { status: 500 }));
    const error = await errorOf(client(broken).generateStructured(request));
    expect(error.code).toBe("failed");
    expect(error.message).toMatch(/HTTP 500/);
  });

  it("rejects an answer outside the schema or not JSON at all instead of guessing", async () => {
    expect((await errorOf(client(answer({ answer: "x" })).generateStructured(request))).code).toBe(
      "invalid_output",
    );
    const prose = vi.fn<typeof fetch>(async () =>
      Response.json({ message: { role: "assistant", content: "The answer is 42." } }),
    );
    expect((await errorOf(client(prose).generateStructured(request))).code).toBe("invalid_output");
  });
});
