# VideoX by Xdigitex — multi-tenant AI video & image SaaS

VideoX is a production-grade, multi-user subscription SaaS for AI image and
video generation, built as an evolution of Xdigitex Video Studio. It runs as a
Cloudflare Workers (Vinext/Next) app with D1 for data and R2 for media, and is
deployed on Xdigitex's own platform at https://video.xdigitex.com.

## Product surface

- **Landing page, registration, login, email verification, password recovery.**
- **Customer dashboard** — credits, plan usage, projects, media library,
  generation history, billing and account settings.
- **Studio editor** — the original editing capabilities (trim, title overlays,
  captions, SRT import/export, browser WebM rendering) plus a multi-provider
  generation workspace with model selection, exact credit estimates and a
  required cost confirmation before any paid job.
- **Admin console** — business analytics (revenue vs provider cost, true gross
  profit, ARPU), customer management, plan editor, provider/key management,
  model & cost editor, margin/pricing rules, payment reconciliation and an
  append-only audit log.

## Architecture highlights

- **Tenant isolation**: every customer-owned row carries an owner column and
  every server-side operation filters on it. No frontend-only checks.
- **Credit ledger**: append-only, idempotent by reference; reservations →
  settle/release with atomic SQL batches; expiry lots; no double deductions,
  no negative spendable balances; failed jobs auto-release.
- **Pricing engine**: true gross margin (`selling = cost / (1 − margin)`),
  global/per-provider/per-model/per-type/per-plan/per-customer rules,
  fixed-price overrides, minimum charges, and an immutable pricing snapshot
  on every generation.
- **Provider adapters**: Runway (Gen-4.5, Aleph 2), OpenAI (images, Whisper,
  prompt), Gemini, Anthropic, DeepSeek, Kling, Replicate, fal.ai, Stability.
  Adapters only declare capabilities they actually implement; the admin
  catalogue is validated against those declarations.
- **Payments**: Pay Xdigitex STK push, server-to-server polling, signed
  webhooks (HMAC-SHA256 over the raw body), idempotent fulfilment, amount and
  receipt verification, refunds, reconciliation cron.
- **Subscriptions**: configurable plans (no hardcoded limits), renewals,
  cancel-at-period-end, grace periods, plan changes, credit top-up packages.

## Development

```sh
pnpm install
npm run dev          # local Vinext dev server (mock auth on localhost)
npm test             # 70 unit/integration tests on real SQLite (node:sqlite)
npm run typecheck
npm run lint
npm run db:check
npm run build
```

Migrations are append-only SQL under `drizzle/`. `0004` seeds plans, credit
packages, providers, models and default pricing; `0005` pins the verified
DeepSeek model code.

## Configuration & deployment

See `.env.example` for every environment variable and `DEPLOYMENT.md` for the
server-161 production layout, update and backup procedures.
