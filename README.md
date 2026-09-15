# Centralized Creator Analytics — scaffold

One dashboard for YouTube, TikTok, Instagram, and Facebook audience numbers.
See `docs/` for the FSD (source of truth for scope and behavior — its version lives
in the document), the product vision and the post-PoC checklist.

## Stack

- **Next.js 16** (App Router, Turbopack by default) + **TypeScript** — UI, API routes, OAuth callbacks
- **Vitest** — test runner (adapter contract, snapshot-job and metrics-math suites land per FSD §13)
- **Supabase free tier** — Postgres + Auth; schema and RLS migrations live in `supabase/migrations/`

Requires **Node.js ≥ 20.9.0** (Next.js 16 minimum); `.nvmrc` pins 24.19.0.

## Getting started

```bash
npm install
npm run dev      # http://localhost:3000
npm test         # runs the Vitest suite
```

Copy `.env.example` to `.env.local` and fill in values as adapters are built.

## Project structure

```
app/            App Router pages, layouts, auth callback + sign-in routes
lib/            token-crypto, adapter types + registry, dashboard metrics, Supabase clients
tests/          Vitest specs — token-crypto, adapter-registry, dashboard-metrics
supabase/       SQL migrations (init + RLS)
docs/plans/     FSD — source of truth for scope and behavior
docs/           Product vision, Post-PoC readiness checklist
```

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | Start the dev server (pins `NODE_ENV=development`) |
| `npm run build` / `npm start` | Production build / serve |
| `npm run lint` | ESLint via eslint-config-next |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Run Vitest once (`--run`) |
| `npm run test:watch` | Vitest in watch mode |

## Status

PoC phase: auth wired, adapter registry + metrics layer built, platform adapters and
the snapshot pipeline in progress. The PoC runs against a zero-cost hosted environment
(free-tier hosting + Supabase) with reviewer-free dev credentials — see `docs/plans/`
§14 for the current phase and what is deferred.
