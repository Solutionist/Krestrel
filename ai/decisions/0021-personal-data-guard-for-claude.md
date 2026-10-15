# 0021: Keep personal data out of everything sent to Claude

- Status: accepted (owner request, 2026-10-15)
- Date: 2026-10-15

## Context

The owner asked for a safeguard that filters personal data out of anything Krestrel sends to Claude. Per feature (ADR 0020):

- **AI outlook, stock ideas, holding groups:** prompts carry tickers, prices, percent weights, public headlines and company names. They have no personal fields by design.
- **Screenshot import:** the image showed everything on the broker screen: the owner's name, account number, email, phone, profile photo and balances.
- **Ambient context**, found by probing the CLI with Krestrel's own flags: Claude Code told the model:
  - its working directory, `C:\Users\<name>\AppData\Local\Temp\krestrel-claude` on Windows, which contains the Windows user name, as did the Read tool's paths;
  - the owner's global `~/.claude/CLAUDE.md` and other memory files;
  - the Claude account's email.

The owner chose **on-device auto-masking with a preview** for screenshots, over text-only OCR, manual redaction, or local-only import. They also chose an **always-on text guard**.

## Decision

- **Shared rules** (`app/lib/pii.ts`, isomorphic):
  - `redactPii(text)` replaces email, phone (needs two separators), SSN, card (Luhn; contiguous only at 15–16 digits), IBAN (mod-97) and labelled account numbers ("Account: 1234-5678") with `[redacted <kind>]`, and counts them by kind.
  - Number patterns refuse to start or end inside a longer number, so prices, amounts, volumes, epoch timestamps and dates are untouched. A test checks that a real outlook prompt passes unchanged.
- **Text guard** (`app/.server/llm/claude-cli.ts`): every Claude prompt and system prompt goes through `redactPii` before the CLI starts. The log records only counts (`personal data redacted from a Claude prompt`), never the values.
- **CLI context:**
  - Claude Code runs with `--safe-mode`, which keeps the owner's CLAUDE.md files, skills, plugins and hooks out of the context; sign-in still works. `--bare` was rejected because it ignores OAuth.
  - On Windows the scratch folder is `%PUBLIC%\krestrel-claude` (no user name). macOS and Linux temp folders carry no user name.
- **Screenshot mask** (`app/components/portfolio/mask-screenshot.ts`, browser only, Claude only):
  1. OCR runs on this computer with tesseract.js (LSTM engine, English). It reads a grayscale copy, inverted for dark themes and enlarged ×2 when narrower than 1600 px.
  2. The output starts **black**, and only lines `ocrLineVerdict` keeps are copied back: holdings rows (a number, or a lone ticker on card layouts) and header rows.
  3. Dropped lines: anything matching the text rules, any personal-field label (name, account, email, phone, address, holder, ID, …), grouped digit blocks ("1234 5678"), and prose. Labels are matched word by word, and a hyphenated name (T-Mobile) is not its parts. A ticker-shaped word (TEL, ID) counts as a symbol, not a label, only on a priced row (a currency mark or a decimal amount) or standing alone: "TEL 10 $1,500.00" is kept, "PHONE 555 1234" and "ID 456789" are dropped. So a ticker that is also a label word, shown with no price, loses its row. A header row may title a column "Name"; no other label is allowed in a header.
  4. Inside a kept row only numbers, tickers, column words and currency marks stay; inside a header only the column titles. Company names and any name beside an amount or among column titles are blacked out, and so is any 7+ digit bare number.
  5. Photos, logos and anything OCR couldn't read stay black.
  6. The result is a fresh canvas PNG, so it has no EXIF or GPS metadata.
- **Preview and consent:** the import panel shows the masked image ("This is exactly what Claude will see") with Send to Claude / Cancel. Nothing is sent before the click. If no row survives, nothing is sent, and the owner is told to crop the screenshot or pick a local model. The review table still shows the original, which stays in the browser.
- **Server enforcement:** `POST /api/portfolio-import` refuses a Claude read unless the upload carries `masked=1` (400 `unmasked`). That guards against any future path that skips the mask.
- **No CDN:** tesseract.js would fetch its worker, engine and model from jsDelivr and tessdata by default. `GET /ocr/:file` serves an allow-list of five files from `node_modules` instead: the worker, three LSTM engine builds (plain, SIMD, relaxed SIMD) and `eng.traineddata.gz` (best_int, 2.9 MB). Anything else is a 404.

## Consequences

- **Local models are unchanged:** no mask and no guard, since nothing leaves the machine.
- **Masking cost:** a few seconds per screenshot the first time (engine and model load; the model is then cached in IndexedDB).
- **OCR misses:** if OCR misses a holdings row, it shows black in the preview. The owner can cancel and crop, or use a local model.
- **What remains visible to Claude by design:**
  - balances and amounts, which aren't identifying;
  - all-caps words of up to 5 letters (they look like tickers);
  - the Claude account's email, which Claude Code adds itself. Anthropic already holds it as the subscription account, so nothing new is disclosed; the CLI has no switch to remove it under OAuth.
- **Shared scratch folder:** on Windows it is readable by other local accounts for the seconds a masked image exists. Krestrel is single-user (ADR 0007), and the image is already masked.
- **Regex limits:** the text guard can't recognise people's names in free text; public figures in headlines are not the owner's data.
