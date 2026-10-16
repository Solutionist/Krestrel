## What and why

<!-- What does this change, and why is it needed? Link the issue if there is one. -->

## Checklist

- [ ] `bun run typecheck && bun run lint && bun run test` pass (DB tests need `bun run db:up`)
- [ ] Matching `ai/` doc updated, plus an ADR for any decision a future reader would question
- [ ] No secrets, `.env` contents or personal data in code, tests, fixtures or screenshots
- [ ] Stays loopback-only and single-user, with no trading, auth or data sharing
