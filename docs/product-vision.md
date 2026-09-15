# Product Vision: Centralized Creator Analytics

- **Version**: 0.3.0
- **Status**: Draft — for owner review
- **Date**: 2026-09-14 (amended 2026-09-15)
- **Owner**: budigital
- **Stable filename**: `docs/product-vision.md` (version lives here, not in filename)
- **Pins**: FSD v1.1.0 at `docs/plans/2026-09-12-creator-analytics-fsd.md`

---

## 1. North star

One home for creator growth, from first 100 followers to agency roster.

A creator connects once, understands growth in plain language, and proves value — first to themselves, later to brands.

Beginner-friendly is a design quality (readable on day one), not an audience limit.

## 2. Where we are now — Phase 1 PoC

Single creator, own accounts, one free-tier hosted environment. Proves the spine end-to-end.

- Scope: FSD v1.1.0 §2 + §14. Auth, 4 adapters in dev mode, daily snapshots, DB-only dashboard, one zero-cost hosted env for OAuth + volunteer validation.
- User: beginner / small creator juggling 2–4 platforms.
- Win condition (PoC, unmeasured): invited testers sign in, connect ≥1 platform, and say "the number feels right". The 7-day return rate is a measured **beta** metric (FSD §14), not a PoC gate.
- Explicitly NOT building: team seats, multi-creator views, exports, rate cards, campaigns, scheduling, mobile native.

PoC is frozen. Vision changes do not expand PoC scope.

## 3. Bigger picture — parked, not built

### Phase 2 — After PoC validates (first returning users)

Agency-lite + pro-creator needs, only when signal arrives:

- Multi-creator view: agency invites / links roster accounts, compares audience + growth side by side.
- Export / media kit: one-page proof (totals, growth, per-platform rows) for brand pitches.
- Permissions: creator owns tokens, grants read-only view to agency; revoke anytime.

No implementation specs yet. Requires discovery: who owns data, what export format brands accept.

### Phase 3 — Later (needs business entity + reviews)

Monetization ops:

- Campaign tracking, rate-card helpers, team seats.
- Gated behind: Meta App Review + Business Verification, Google verification, TikTok approval (see FSD §9, §14).

### Never (current stance)

Scheduling, publishing, comment/DM management, ads, hashtag research, native mobile apps. Revisit only if vision changes.

## 4. Evidence so far

- Beginners: analytics jargon confusing, juggling 2–4 native apps gives headache. Want one simple number + plain labels.
- Huge creators: past a milestone, need help with portfolio, rate cards, campaigns.
- One agency: all-in-one roster management would be great help.

Reading: three segments, one spine. Beginners validate the core metric. Huge + agency validate willingness to pay later — but need different permissions and views. Hence Phase 1 → Phase 2 order.

## 5. Business notes (BRD-lite, free for now)

- Pricing: free for now, revisit post-PoC (owner-confirmed, FSD decision log).
- Entity: register later. Blocks Meta public launch; PoC unaffected (Standard Access, own accounts).
- Cost envelope: infra-only, free/low tiers while small (FSD §12).
- Risk: YouTube project-wide 10k quota, verification turnaround, TikTok approval outcome (FSD §15).

Full BRD deferred until Phase 2 discovery.

## 6. Open questions

1. Agency data ownership: does agency view live tokens or cached snapshots? Revoke path?
2. Rate-card formula: what inputs do brands actually trust (followers, views-7d, engagement)?
3. Export shape: PDF, link, or CSV? What closes a brand deal?
4. Pricing: per-creator seat, per-agency roster, or flat? No guess until beta retention.
5. Product name / domain: 10 candidates in FSD §15, unchecked. Needed before public artifacts.

## Appendix — Revision history

**Convention:** `0.x` = draft under review, minor bump per revision round. `1.0.0` = approved baseline. Filenames stay stable.

| Version | Date | Author | Change |
|---------|------|--------|--------|
| 0.1.0 | 2026-09-14 | budigital | Initial vision draft. Locks PoC scope, parks agency/pro features as Phase 2/3, records interview evidence. |
| 0.2.0 | 2026-09-15 | budigital | PoC now includes one free-tier hosted environment and invited-tester validation (aligns with FSD 1.1.0); pin bumped. |
| 0.3.0 | 2026-09-15 | budigital | Win condition restated as PoC-qualitative; the 7-day return rate is explicitly a beta metric (FSD §14). Pin bumped to FSD v1.2.0. |
