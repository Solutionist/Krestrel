# 0018: Import holdings from a broker screenshot (local vision model)

- Status: accepted (owner request, 2026-10-15)
- Date: 2026-10-15

## Context

The owner asked to capture a broker screen (mainly the Dime app's mobile holdings list) and turn it into portfolio entries instead of typing each holding. Choices made with the owner:

1. **Open model on this machine, nothing leaves it**, rather than Claude vision. A screenshot carries amounts, share counts and possibly account numbers, beyond what ADR 0017 sends (tickers and percent weights only).
2. **Current holdings** (ticker, shares, average cost), not trade history.
3. **Editable review table, then Import**: misreads never reach the ledger unseen.
4. **Paste, drag-drop, or file picker.**
5. **A vision-language model via Ollama (Qwen3-VL 8B)**, replacing a first version built on tesseract.js. Tesseract only returns text: layouts then needed a hand-written column/label parser, and it misread small or dark-theme text. A vision model reads the layout itself and answers in a fixed JSON shape.

## Decision

- **Model:** `qwen3-vl:8b-instruct` by default (`OLLAMA_VISION_MODEL`) on the owner's Ollama at `OLLAMA_URL` (default `http://127.0.0.1:11434`). The URL must be loopback (127.0.0.1, localhost, [::1]); anything else is a config error, so screenshots can't be sent elsewhere by mistake. The plain `qwen3-vl:8b` tag is the thinking build: it ignores `think: false`, and on an RTX 4090 a read took 10–22 s versus 2–3 s for instruct, with the same results on the test screenshots.
- **Call** (`app/.server/portfolio-import/vision.ts`): `POST /api/chat`. The request has a system prompt, the image as base64, and `format` = the JSON Schema of `{currency, holdings: [{symbol, shares, averageCost}]}`, which Ollama enforces as a grammar. It also sets `stream: false`, `think: false`, `temperature: 0`, `num_ctx: 16384` and a 5-minute timeout. The 4096-token default can't hold a phone screenshot (~3,000 image tokens) plus the answer, so the reply would stop empty. The answer is re-validated with Zod.
- **Cleaning:** tickers are normalised (BRK/B, BRK-B → BRK.B) and checked with `SymbolSchema`; amounts that aren't positive become null for the owner to fill. Rows with neither shares nor cost are dropped. A duplicate ticker keeps the row with more fields. Then tickers the provider doesn't list (`hub.verifyListed`) are dropped.
- **Currency:** trades are recorded in USD. The model copies the currency mark printed by the costs, and Krestrel maps it to a code ($ → USD, ฿ → THB, …); a non-USD code warns in the review. The model can misread a small ฿ as $, so a second, model-independent check also warns when an average cost is more than 8× today's price (baht costs are ~33× the dollar price).
- **Browser:** images over 3.2 MP are shrunk before upload (~1 vision token per 32×32 px), never enlarged, colours kept.
- **API:** `POST /api/portfolio-import` (multipart `image`, PNG/JPEG/WebP, ≤ 20 MB) returns holdings and saves nothing. Errors: `unavailable`/`model_missing`/`config` 503, `timeout` 504, `invalid_output`/`failed` 502, `nothing_found` 422. `POST /api/portfolios {intent:"importTrades", portfolioId, trades[≤100]}` checks every ticker against the listing first and names all unknown ones. Only then does it watch the symbols and insert all trades in one transaction (`addTrades`, same oversell check and lock as single trades).
- **Recording:** each holding becomes one buy at its average cost, fee 0, on a date the owner picks (default today, New York).
- **UI:** "Import screenshot" in the Holdings header, or paste an image anywhere on the portfolio page. The review shows the screenshot beside editable rows (ticker, shares, avg cost; add/remove).

## Consequences

- Needs Ollama installed and the model pulled (~6 GB). It runs fast on a GPU or Apple Silicon; CPU-only machines can take minutes per screenshot. The model stays loaded for 5 minutes after a read (Ollama default).
- Not available in the Docker image: the container can't reach the host's loopback-only Ollama.
- No data leaves the machine except the tickers read, which are checked against the provider's listing, the same as adding to the watchlist.
- A vision model can still misread; the review table and listing check are the safeguard.
- The per-buy date is a stand-in: realized P/L on later sells is right, but holding periods start on the chosen date.
