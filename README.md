# Centralized Creator Analytics — scaffold

One dashboard for YouTube, TikTok, Instagram, and Facebook audience numbers.
See `docs/plans/` for the FSD and phasing docs this scaffold implements
(FSD v1.0.0, §14 "Current phase — PoC").

## Stack

- **Next.js 16** (App Router, Turbopack by default) + **TypeScript** — UI, API routes, OAuth callbacks
- **Vitest** — test runner (adapter contract tests, snapshot-job tests, metrics-math tests per FSD §13)
- **Supabase free tier** — Postgres + Auth, added once the schema (FSD §7) lands

Requires **Node.js ≥ 20.9.0** (Next.js 16 minimum).

## Getting started

```bash
npm install
npm run dev      # http://localhost:3000
npm test         # runs Vitest (empty suite for now, exits 0)
```

Copy `.env.example` to `.env.local` and fill in values as adapters are built.
Nothing in this scaffold talks to Supabase or any platform API yet.

## Project structure

```
app/            App Router pages, layouts, (later) API routes
lib/            Adapters, DB client, snapshot logic — empty until built
tests/          Vitest specs — empty until adapters/snapshot job exist
docs/plans/     FSD, product vision, phasing docs (source of truth)
```

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | Start the dev server |
| `npm run build` / `npm start` | Production build / serve |
| `npm test` | Run Vitest once (`--run`); passes on an empty suite |
| `npm run test:watch` | Vitest in watch mode |
| `npm run lint` | Next.js ESLint |

## Status

PoC phase (local-first, own accounts, no hosting/review submissions yet — see
`docs/plans` and the Post-PoC Readiness Checklist for what's deferred).
