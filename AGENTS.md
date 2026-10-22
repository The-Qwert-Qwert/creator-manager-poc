# AGENTS.md — creator-manager-poc

Centralized creator analytics dashboard (YouTube, TikTok, Instagram, Facebook).
One combined audience number, per-platform rows, and a daily history the native apps
don't give creators. PoC phase — see `docs/plans/` §14.

Next.js 16 (App Router) + TypeScript + Vitest + Supabase (Postgres/Auth), npm package
`centralized-analytics@0.1.0` (private), repo `The-Qwert-Qwert/creator-manager-poc`.

## Commands (verified against package.json)

```bash
npm install            # engines: node >=20.9.0; .nvmrc pins 24.19.0
npm run dev            # next dev (NODE_ENV=development) — http://localhost:3000
npm run build          # next build
npm start              # serve the production build
npm run lint           # eslint .
npm run typecheck      # tsc --noEmit
npm test               # vitest run
npm run test:watch     # vitest (watch)
```

CI (`.github/workflows/ci.yml`) runs `npm ci` → `lint` → `typecheck` → `test` on PRs and
on pushes to `main` and `poc-mvp-phase-1`. Reproduce those three locally before claiming
a change is done; run `npm run build` too when routes or config change.

## Source of truth

`docs/plans/` is the spec, not the README:

- `docs/plans/2026-09-12-creator-analytics-fsd.md` — FSD v1.0.0, the architecture
  contract (§7 schema, §8/§10 token encryption, §13 test plan, §14 current phase = PoC)
- `docs/product-vision.md`, `docs/post-poc-checklist.md`

Read the relevant FSD section before building a feature and cite it in the PR body. Don't
invent design that contradicts it — ask first.

## Layout

```
app/                     App Router: dashboard/, auth/sign-in, auth/callback,
                         api/auth/[platform]/{route,callback/route}.ts
lib/adapters/            youtube, tiktok, instagram, facebook + types.ts, registry.ts
lib/auth/                session, state (CSRF signing), redirect, index
lib/snapshot/            core.ts (daily batch) and store.ts (idempotent upserts)
lib/dashboard/           metrics.ts (combined + delta math), manual-refresh.ts
lib/supabase/            client, server, admin, bytea | lib/token-crypto.ts (AES-256-GCM)
lib/config.ts            env/config resolution
proxy.ts                 Next.js request middleware (formerly middleware.ts)
supabase/migrations/     0001_init, 0002_rls, 0003_manual_refresh
tests/                   ~20 Vitest specs + platform JSON fixtures
```

## Conventions

- TypeScript `strict` **and** `noUncheckedIndexedAccess` (plus `noUnusedLocals`,
  `noUnusedParameters`, `verbatimModuleSyntax`, `allowJs: false`). Handle `undefined`
  from index access instead of using `!`.
- Import via `@/*` (baseUrl `.`). No relative `../../` climbs across top-level dirs.
- App Router only: pages/routes under `app/`, platform adapters and snapshot logic under
  `lib/`, specs under `tests/**/*.{test,spec}.ts(x)` (Vitest, `environment: node`).
- Secrets: `.env.example` is the template, real values go in `.env.local` (gitignored).
  `TOKEN_ENC_KEY`, `APP_SECRET` and `CRON_SECRET` are generated locally and never
  committed. Never log a platform access token, and never write one into fixtures or
  snapshots.
- Platform OAuth apps during PoC: own dev apps, self-serve dev mode (FSD §14) — no
  production credentials. The Google client is unpublished, so teammates must be added
  as test users before connecting.
- Tests must not hit live platform APIs or Supabase — mock at the adapter boundary.
- Meta platforms are flag-gated behind `ENABLE_META` (default on in dev, off in prod)
  until App Review and Business Verification land.

## Plane tracker

Work items live in Plane, scoped to one project:

| Thing | Value |
|---|---|
| Workspace slug | `creator-manager-wip` |
| Project | `CREAT` — creator-manager-wip |
| Project ID (UUID) | `e8e67dfa-a8bf-40e5-8980-97989186977b` |
| Ticket style | `CREAT-<n>` — branch names carry it, e.g. `feat/CREAT-11-snapshot-core` |

Any Plane MCP server is workspace-scoped (no project-level tokens), so pass
`project_id=e8e67dfa-a8bf-40e5-8980-97989186977b` on every project-scoped call —
`workitem`, `cycle`, `module`, `label`, `state`, `milestone`, `intake`, `work_log`.
Resolve display names to UUIDs before filtering (`workitem list` filters on UUID-backed
fields), and call `get_pql_reference` before composing an unfamiliar PQL query. Read
(`list`/`count`) before write; state transitions need the `state_id` UUID.

Don't mirror Plane state into the repo — Plane is the source of truth for work items,
`docs/plans/` for specs.

### Optional: Plane MCP server

Official server (`makeplane/plane-mcp-server`, MIT; 30 tools, one per resource, each
taking an `action` param). Config accepted by Claude Code, Codex, Cursor and similar
clients:

```json
{
  "mcpServers": {
    "plane": {
      "command": "uvx",
      "args": ["plane-mcp-server", "stdio"],
      "env": {
        "PLANE_API_KEY": "${PLANE_API_KEY}",
        "PLANE_WORKSPACE_SLUG": "creator-manager-wip"
      }
    }
  }
}
```

Set `PLANE_API_KEY` in your shell or secret store (Plane → Workspace Settings → API
tokens); never commit it. Requires Python 3.10+, or pre-install with
`uv tool install plane-mcp-server` and use that binary instead of `uvx`. A hosted
alternative is `https://mcp.plane.so/http/mcp` (OAuth) or
`https://mcp.plane.so/http/api-key/mcp` with `Authorization: Bearer <token>` and
`X-Workspace-slug` headers.

## Git / delivery

- `main` is the default branch but currently holds only the initial scaffold; active work
  is on `poc-mvp-phase-1` / `develop`. Branch off the active integration branch, name it
  after the Plane ID, open a PR, and report the PR URL.
- Commits: imperative subject, explain *why* in the body. Keep unrelated changes out of
  a PR.
- Push before you stop if you're working in a disposable checkout — GitHub is the source
  of truth.
