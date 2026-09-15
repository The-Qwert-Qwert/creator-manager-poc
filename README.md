# Centralized Creator Analytics — scaffold

One dashboard for YouTube, TikTok, Instagram, and Facebook audience numbers.
See `docs/` for the FSD (v1.0.0, §14 "Current phase — PoC"), the product vision
and the post-PoC checklist.

## Stack

- **Next.js 16** (App Router, Turbopack by default) + **TypeScript** — UI, API routes, OAuth callbacks
- **Vitest** — test runner (adapter contract, snapshot-job and metrics-math suites land per FSD §13)
- **Supabase free tier** — Postgres + Auth, added once the schema (FSD §7) lands

Requires **Node.js ≥ 20.9.0** (Next.js 16 minimum); `.nvmrc` pins 24.19.0.

## Getting started

```bash
npm install
npm run dev      # http://localhost:3000
npm test         # runs the Vitest suite
```

Copy `.env.example` to `.env.local` and fill in values as adapters are built.
Nothing in this scaffold talks to Supabase or any platform API yet.

## Project structure

```
app/            App Router pages, layouts, (later) API routes
lib/            token-crypto.ts built; adapters, DB client, snapshot logic land next
tests/          Vitest specs — token-crypto.test.ts so far
docs/plans/     FSD v1.0.0 — source of truth for scope and behavior
docs/           Product vision, Post-PoC readiness checklist
```

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | Start the dev server |
| `npm run build` / `npm start` | Production build / serve |
| `npm run lint` | ESLint via eslint-config-next |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Run Vitest once (`--run`) |
| `npm run test:watch` | Vitest in watch mode |

## Status

PoC phase (local-first, own accounts, no hosting/review submissions yet — see
`docs/` for what's deferred).
