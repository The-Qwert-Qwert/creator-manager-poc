# Post-PoC Readiness Checklist

- **Version**: 0.3.0
- **Status**: Draft — for owner review
- **Date**: 2026-09-14 (amended 2026-09-15)
- **Owner**: budigital
- **Stable filename**: `docs/post-poc-checklist.md` (version lives here, not in filename)
- **Pins**: FSD v1.2.0, Product Vision v0.3.0
- **Rule**: Do not start until PoC §14 done (4 connects work, snapshots idempotent, dashboard DB-only, reconnect banner works).

---

## 1. Stack (cheap-to-zero, no VPS)

| Need | Pick | Cost | Why |
|------|------|------|-----|
| App hosting | Vercel Hobby | $0 | Next.js native, TLS + previews free. Alt: Cloudflare Pages $0 |
| DB + Auth | Supabase Free | $0 | Keep PoC Postgres + RLS + magic link. Pro $25/mo only after >500MB or >50k MAU |
| Cron | GitHub Actions schedule | $0 | Daily `curl /api/cron/snapshot` with `Bearer CRON_SECRET`. Skip Vercel Cron (paid) |
| Domain + DNS | Cloudflare Registrar | ~$10-12/yr | Required for reviews; privacy page must live on same domain |
| Email login | Supabase built-in SMTP | $0 | Fine for <10 beta testers. Then Resend free 3k/mo |
| Uptime | UptimeRobot free | $0 | 50 monitors, ping dashboard + cron |
| Errors | Sentry free | $0 | 5k events/mo, catch 401/429 storms |
| Backups | Supabase auto + weekly `pg_dump` local | $0 | Covers token table loss |

Do NOT buy: VPS, KMS (env key enough for beta), Phyllo-class vendor (~$199+/mo floor, already rejected), S3/CDN, native mobile.

**Already in use by the PoC (FSD §14):** Vercel Hobby + Supabase free host the PoC environment with **dev** credentials and no custom domain. The §4 cutover is a separate production environment — do not reuse the PoC Vercel project or Supabase project for it.

**Snapshot execution (decided):** the account loop runs inside the scheduler job; `/api/cron/snapshot` is a thin trigger that stays inside the serverless time budget. Vercel Hobby is licensed for **non-commercial** use — re-plan hosting before any monetization. GitHub scheduled workflows can be delayed and are auto-disabled after ~60 days of repo inactivity, so keep the workflow alive and alert if no snapshot row lands by 06:00 UTC.

## 2. Compliance pages (must exist before any submission)

Build inside same Next.js app, same domain:

- [ ] `/privacy` — what data stored (counts + handles only), token encryption note, contact
- [ ] `/terms` — acceptable use, free beta disclaimer
- [ ] `/data-deletion` — how to request delete + Meta callback status URL (FSD FR-9)
- [ ] Domain verified in Google Search Console

No pages = auto-reject by Google + Meta.

## 3. Review submissions (order matters)

- [ ] Google OAuth verification: External prod consent, scopes `youtube.readonly` + `yt-analytics.readonly`, demo video, privacy URL, domain ownership. Budget >3–5 days.
- [ ] TikTok Login Kit + scope approval: `user.info.basic`, `user.info.stats`, `video.list`. Weakest data even if approved — set UI expectations.
- [ ] Meta App Review + Business Verification (needs entity/PT): app #1 IG Login, app #2 FB Login. Blocked until entity exists — Meta stays flag-gated.
- [ ] Launch order: YouTube + TikTok public first; Meta flips on per approval.

## 4. Cutover steps (dev → prod)

- [ ] New OAuth apps/projects for prod (separate from dev; Google policy expects it)
- [ ] Prod env vars in Vercel: `TOKEN_ENC_KEY`, `APP_SECRET`, `CRON_SECRET`, all platform client IDs/secrets, `GRAPH_VERSION`, Supabase URL/keys
- [ ] Supabase prod project + apply `0001_init.sql` + verify RLS
- [ ] GitHub Actions cron: `0 3 * * *` (03:00 WIB) → prod snapshot endpoint
- [ ] Manual verify: connect 1 account → run cron → dashboard renders from DB → disconnect/delete purges
- [ ] Sentry + UptimeRobot live

## 5. Beta exit bar

Starts after the PoC gate (FSD §14) and the **YouTube + TikTok** submissions in §3. Meta App Review / Business Verification is **not** a beta-entry dependency — Meta stays flag-gated (FSD §14). This bar is **measured on production** — it is not the PoC volunteer validation, which is qualitative, unmeasured, and runs on platform test users (FSD §14 boundary note).

- [ ] ≥3 testers with ≥2 platforms connected
- [ ] 7-day return rate ≥ X% — owner sets X before beta starts
- [ ] Snapshot success rate >99%
- [ ] "Number feels right" feedback collected (qualitative, not a metric)

## 6. Total to be ready

$0 + ~150k IDR/yr domain. Entity/PT deferred until Meta public launch needs it.

## Appendix — Revision history

| Version | Date | Author | Change |
|---------|------|--------|--------|
| 0.1.0 | 2026-09-14 | budigital | Initial post-PoC stack + submission order. Pinned to FSD v1.0.0. |
| 0.2.0 | 2026-09-15 | budigital | Beta exit bar marked production-measured and distinct from PoC volunteer validation; stack note that the PoC env already runs on the free tier. Pinned to FSD v1.1.0. |
| 0.3.0 | 2026-09-15 | budigital | Beta entry no longer waits on the Meta review; return-rate threshold left for the owner to set; snapshot execution model, Vercel non-commercial licence and scheduler-reliability notes added. Pinned to FSD v1.2.0. |
