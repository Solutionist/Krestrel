# 0020: Claude or a local model for every AI feature

- Status: accepted (owner request, 2026-10-15)
- Date: 2026-10-15

## Context

Each AI feature was tied to one backend: the AI outlook and stock ideas to Claude (ADR 0012, 0016, 0017), and screenshot import and holding groups to the owner's local Ollama model (ADR 0018, 0019). The owner asked for every feature to work with either, and chose:

1. **One global default plus an optional model per feature.**
2. **Web research for local models through Tavily**, using the owner's own `TAVILY_API_KEY`. Claude keeps its built-in web search.
3. **Local models as Large · Medium · Small presets plus anything else installed**, with a Download button, so people without a 24 GB GPU still get a model that runs.

## Decision

- **Contract** (`app/lib/ai.ts`): `AiChoice` is `{provider:"claude", model: alias}` or `{provider:"local", model: string | null}`, where `null` means the server's `OLLAMA_MODEL`. Features: `outlook`, `ideas`, `import`, `grouping`. Every AI request body (or the `ai` form field for import) carries one choice. Without one, a route uses Claude for outlook and ideas and the local default for import and grouping.
- **Presets** (`LOCAL_MODEL_PRESETS`): Large `qwen3.8:27b` (~17 GB download, 24 GB GPU), Medium `qwen3-vl:8b-instruct` (6.1 GB), Small `qwen3-vl:4b-instruct` (3.3 GB). All three read images, so any of them can do every feature.
- **One client interface** (`app/.server/llm/types.ts`): `LlmClient.generateStructured({ prompt, schema, images?, webSearch?, … })` with `capabilities.webSearch`, one `LlmError` (codes include `unavailable`, `model_missing`, `unsupported`) and `LLM_ERROR_STATUS`.
  - `claude-cli.ts`: `createClaudeCliClient(deps)` returns a factory per model alias. All Claude clients share one in-flight guard. `webSearch` enables WebSearch/WebFetch. Images are written into the throwaway scratch dir and read with the Read tool, then removed.
  - `ollama.ts`: loopback-only `OLLAMA_URL`, JSON-schema `format`, `num_ctx` 16384. No web search.
  - `instance.ts`: `getAi(choice)`, `getWebSearch()`, `aiFailureResponse` (`LlmError`/`ConfigError` → `{ok:false,error}` with its status).
- **Research** (`research.ts`, `web-search.ts`), recorded in each response as `research` plus an optional `researchNote`:
  - `web`: Claude searches on its own.
  - `tavily`: the model is local and `TAVILY_API_KEY` is set. Krestrel runs fixed queries first (`outlookQueries`: ticker news and analyst ratings; `ideasQueries`: the focus sector or a general market search, never holdings) and inlines the results, de-duplicated by URL, into the prompt.
  - `none`: no key, or every Tavily query failed (the failure message becomes the note). The model works from the prompt's data and its own knowledge.
  - In `tavily` and `none` modes, links the model returns are kept only if they appear in the feed headlines or the Tavily results (`citationCheck` in `research.ts`, comparing canonical `httpUrl` forms). This stops a local model from inventing sources.
- **Local models API** (`app/routes/api.ai.ts`): `GET /api/ai` → `AiStatus` (Claude enabled, Ollama reachable, installed models with size and vision support via `/api/tags` + `/api/show`, presets not yet installed, Tavily configured). `POST /api/ai {intent:"pull", model}` streams Ollama's pull progress as NDJSON. Same-origin only.
- **UI:** the top bar's **AI** menu sets the default, the per-feature models, downloads, and shows Claude/Ollama/Tavily readiness; opening it reloads the status, so Ollama started or a model pulled since the page loaded shows up. The menu rows, the outlook panel, ideas sidebar and import panel all use `FeatureModelPicker` (on `AiModelPicker`), set to "Default (…)" unless overridden; `useFeatureModel` gives a feature's model and display name. Every picker reads one shared status fetcher, loaded once per page however many are mounted. Choices are stored in `krestrel.ai.default` and `krestrel.ai.overrides`, and replace the old `krestrel.claudeModel`. Models that can't read images are disabled for import.

## Consequences

- **Privacy depends on the choice, and the UI says which:**
  - Local models: nothing leaves the machine except Tavily search queries (a ticker, or a sector name plus the year) when a key is set.
  - Claude: the outlook sends the ticker, candles and headlines; ideas send held tickers and percent weights; import sends only a masked copy of the screenshot, approved by the owner; grouping sends tickers and company names, automatically when grouping is on. Every Claude prompt also passes the personal-data guard (ADR 0021).
  - The confirm-once consent prompts for outlook and ideas only appear for Claude.
- Local outlooks and ideas are only as current as Tavily's results; without a key they rely on the feed and the model's training data, and the response says so.
- `OLLAMA_VISION_MODEL` was renamed `OLLAMA_MODEL`, since it is now the default local model for every feature.
- Claude can't be verified on a machine where `claude` isn't signed in; the error response says to sign in.
