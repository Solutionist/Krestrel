import { describe, expect, it } from "vitest";

import { AiChoiceSchema } from "./ai";

describe("AiChoiceSchema (stored choices and request bodies)", () => {
  it.each([
    "qwen3-vl:8b-instruct",
    "qwen3.8:27b",
    "library/llama3:latest",
    "hf.co/bartowski/Llama-3.2-3B-Instruct-GGUF:Q4_K_M",
    "registry.ollama.ai/library/llama3:latest",
  ])("accepts the local model %s as Ollama lists it", (model) => {
    expect(AiChoiceSchema.safeParse({ provider: "local", model }).success).toBe(true);
  });

  it.each(["", "../etc/passwd", "/abs:1", "http://evil/x:1", "has space:1", "a//b:1", "x:"])(
    "rejects the malformed name %j",
    (model) => {
      expect(AiChoiceSchema.safeParse({ provider: "local", model }).success).toBe(false);
    },
  );
});
