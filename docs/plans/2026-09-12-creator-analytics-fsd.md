# FSD: Centralized Creator Analytics

- **Version**: 1.2.0
- **Status**: Approved — baseline (amended 2026-09-15)
- **Current phase**: PoC (hosted, ~zero cost) — all four adapters, dev-mode apps, owner accounts (see §14)
- **Date**: 2026-09-12
- **Owner**: budigital
- **Working title**: centralized-analytics (product naming TBD)

---

## 1. Overview

A web app that gives online creators one simple dashboard for their YouTube, TikTok, Instagram, and Facebook numbers. Connect a platform in one click, see one combined audience number plus a per-platform breakdown. No jargon, no per-platform tool learning. Beginner-friendly is a design requirement — readable on day one — not a limit on who the product is for.

The product exists because creators currently open 2–4 native apps, each with different metrics, different names for the same thing, and no shared history. This app centralizes viewing — nothing else (no scheduling, publishing, messaging, or ads).

**Approach chosen**: direct platform integrations (own OAuth apps), daily snapshot pipeline, dashboard served entirely from our own database. Vendor unified APIs (Phyllo-class) rejected: ~$199+/mo floor, incompatible with a free product.

## 2. Goals & non-goals

### Goals
- One-click connect per platform, independent of other platforms.
- One combined audience number, week-over-week, plus per-platform rows.
- Uniform daily history across all platforms (something native apps don't provide).
- Beginner-friendly labels — plain language, self-explanatory metrics — and honest explanations when a platform withholds a metric.
- Secure token handling; minimal data collection.
- Public launch on YouTube + TikTok first; Meta platforms open as approvals land (see §14).

### Non-goals (v1)
- Scheduling, publishing, comment/DM management, ads, hashtag research.
- Team seats, exports, API access, white-label.
- AI/insight generation (a defined later possibility — "explain-it-to-me layer" — but not v1).
- Native mobile apps (responsive web only).
- Displaying post-level content (touches TikTok display terms; post metrics may come later as counts only).

## 3. Target users

- Any online creator who actively uses 2–4 platforms (or just one) and wants their numbers in one place. No follower-range scoping.
- Beginner-friendly is a product quality, not a user-segment constraint: readable on day one, still useful to experienced creators who don't want to learn four separate tools.
- Needs: "Am I growing?", "What's my total reach?", "Why do my four apps disagree?"
- Design constraint from the low end: some accounts sit under platform gates (<100 followers on IG, <100 Page likes on FB) where insights get locked — fallbacks (§5 FR-7) must keep the dashboard honest and complete for those users too.

## 4. Core user flows

1. **Sign up** — email magic link or Google sign-in. Minimal profile.
2. **Connect platform** — dashboard shows four connect buttons. Each starts that platform's OAuth flow; success returns to dashboard with the new platform row. One platform is enough to be useful; connect more anytime.
3. **Daily view** — user opens dashboard: combined audience number, delta vs 7 days ago, per-platform rows (logo, handle, audience, delta, last-updated). If history < 8 days, delta shows "—" with a "building history" note.
4. **Reconnect** — if a token dies, that platform's row shows a plain banner: "TikTok connection expired — reconnect". One click re-runs OAuth.
5. **Disconnect / delete** — disconnect removes tokens and stops snapshots for that platform. Delete account purges everything, and a stub "data deletion" callback endpoint exists for Meta compliance.

## 5. Functional requirements

| ID | Requirement | Acceptance criteria |
|----|-------------|---------------------|
| FR-1 | User auth | Sign up/sign in with magic link or Google. Session cookie, server-side session validation. |
| FR-2 | Connect platform | Per-platform OAuth with CSRF `state`. Handles denial gracefully. Stores encrypted tokens + platform IDs. Idempotent re-connect updates existing row (no duplicates). |
| FR-3 | Daily snapshot job | Runs once daily (cron). Per active account: 1–2 adapter calls → one `metric_snapshots` row. Idempotent (unique account+date upsert). Failures isolated per account; batch continues. |
| FR-4 | Dashboard | Renders solely from our DB. Combined audience + 7-day delta + per-platform rows. Never calls platform APIs on page load. |
| FR-5 | Token lifecycle | Auto-refresh per platform rules (see §9). Mark `needs_reconnect` on failure; stop retrying; surface banner. |
| FR-6 | Manual refresh | User-initiated button per account. Never fires on dashboard page load; server-enforced cooldown of ≥1 hour between refreshes per account. |
| FR-7 | Gated-metric fallbacks | When a platform withholds a metric, show the best available numbers plus a plain-language note. No broken/empty widgets. |
| FR-8 | Disconnect platform | Deletes tokens, stops snapshots, purges that account's history. Best-effort token revocation at platform where an endpoint exists. |
| FR-9 | Delete account | Purges user + all accounts + snapshots. Meta data-deletion callback endpoint (signed request) + status URL. |
| FR-10 | Status surfacing | Per-account state visible: active / needs reconnect / gated metrics. Last-updated timestamp always visible. |

## 6. Metric definitions (plain-language labels)

| Internal | Label shown to user | Source |
|----------|--------------------|--------|
| `audience_count` per platform | Followers / Subscribers | Platform profile fields (see §9) |
| Combined audience | "Total audience across platforms" + note: "Same person can follow you on more than one platform — this is a count, not unique people." | Sum of per-platform audience |
| Growth | "vs 7 days ago" | Our snapshots (needs ≥8 days of history) |
| 30-day sparkline | Simple line, no axes jargon | Our snapshots |

Combined number is a count, explicitly labeled as such — the honest simplification.

## 7. Data model (Postgres)

```
users
  id, email, created_at

connected_accounts
  id, user_id FK, platform ENUM(youtube,tiktok,instagram,facebook),
  external_id TEXT, handle TEXT, avatar_url TEXT,
  access_token_enc BYTEA, refresh_token_enc BYTEA, token_expires_at TIMESTAMPTZ,
  scopes TEXT, status ENUM(active, needs_reconnect, revoked),
  last_synced_at, created_at,
  UNIQUE (user_id, platform, external_id)

metric_snapshots
  id, connected_account_id FK, captured_on DATE,
  audience_count BIGINT, extras JSONB,
  created_at,
  UNIQUE (connected_account_id, captured_on)
```

Notes: `extras` holds platform-specific counts that don't deserve columns (video count, total likes, etc.). Post-level tables deferred (P1). No user-generated content stored.

## 8. Architecture & data flow

- **App**: single Next.js app — UI, API routes, OAuth callbacks. Responsive web, mobile-first (one-tap connect matters).
- **DB**: managed Postgres.
- **Cron**: daily snapshot job (platform cron or scheduler service).
- **Adapters**: one interface, four implementations.

```
interface PlatformAdapter {
  platform: Platform
  authUrl(state: string): string
  exchangeCode(code: string): Promise<{ tokens, externalId, handle }>
  refresh(tokens): Promise<tokens>
  fetchProfile(account): Promise<{ handle, avatarUrl?, audienceCount, extras }>
}
```

**Flow**: cron → for each active account → adapter.fetchProfile → upsert snapshot → done. Dashboard reads DB only.

Why snapshots are the spine: TikTok exposes no historical API at all, Meta limits insight windows, and per-platform rate limits make live dashboard fetches unsafe. Daily snapshots (a) respect rate budgets, (b) make the dashboard fast and platform-outage-proof, and (c) create uniform cross-platform history that native apps don't give you.

**Token security**: AES-256-GCM encryption at rest, key in environment (KMS later if needed). Tokens never reach the client. Server-side only.

**Environment separation**: separate OAuth apps/projects for dev vs prod (Google policy expects it; prevents accidental quota/verification bleed).

## 9. Platform integration specs

### 9.1 YouTube (launch platform)
- **Auth (v1/PoC)**: Google OAuth 2.0 with scope `youtube.readonly` only (channels.list data). `yt-analytics.readonly` is deliberately **not** requested in v1 — Analytics is a P1 source, and requesting an unused sensitive scope enlarges the review gate (least privilege, §10).
- **Metrics v1**: subscribers, video count, channel title/avatar via `channels.list` (1 quota unit).
- **Quota**: Data API default 10,000 units/day **per project (all users combined)**; `channels.list` = 1 unit → ~5–9k accounts/day of headroom with a daily snapshot. Free quota extension exists via Google's quota & compliance audit — necessary path at scale.
- **Analytics API (P1)**: when this lands, add scope `yt-analytics.readonly` and verify the `reports.query` scope requirement then (§15 risks 5–6). Separate per-query quota; exact default confirmed at that point.
- **Token lifecycle**: access token ~1h, refresh token long-lived; refresh shortly before expiry; handle revocation.
- **Review gate**: public launch requires OAuth verification (sensitive scopes): privacy policy on the same domain, domain ownership verified, branding, demo video, scope justification. Google cites ~3–5 business days; plan for longer. Until verified: test users only (user cap, tester warning screens).

### 9.2 TikTok (launch platform)
- **Scopes**: `user.info.basic`, `user.info.stats` (follower/like/following/video counts), `video.list` (public videos; P1 post metrics).
- **Metrics v1**: follower count, total likes, video count via `/v2/user/info/`.
- **Constraints**: no historical API — follower/like counts are current-only (our snapshots create the history). Per-video data is cumulative (view/like/comment/share counts); per-post P1 work requires snapshot deltas.
- **Content rules**: `cover_image_url` has a 6-hour TTL — never cache or proxy these. If we ever display video content, use `embed_link` per TikTok's display terms (v1 displays no post content).
- **Token lifecycle**: access token 24h, refresh token 1 year. Docs recommend token refresh cadence around every 12h; rotate on schedule.
- **Review gate**: TikTok developer account + approval for Login Kit and API products + granted scopes. Beta works with app in development mode (app owner's accounts).

### 9.3 Instagram (built in v1, live behind flag)
- **Config choice**: Instagram API with Instagram Login (IG-credentials login) — cleaner "one-click" for creators with IG-only presence. Note: Facebook Login vs Instagram Login are **mutually exclusive per Meta app**, so Facebook Pages requires a second, separate Meta app (§9.4).
- **Scopes**: `instagram_business_basic` (+ insights path). App users must have an Instagram **professional** (business/creator) account.
- **Metrics v1**: total followers (`followers_count` field). Gated: the `follower_count` **insights metric** (daily series) and `online_followers` are unavailable below 100 followers — fallback shows total followers + reach where available, with a plain-language note.
- **Token lifecycle**: short-lived (1h) → long-lived 60 days; refresh requires token ≥24h old and valid; tokens unrefreshed for 60 days die permanently.
- **Rate limits**: Business Use Case formula — calls within 24h = 4800 × (content impressions in last 24h); per app+user pair. Generous for active accounts, tight for dormant ones (handle 429s with backoff).
- **Review gate**: public launch requires **App Review + Business Verification** (Advanced Access) for serving accounts you don't own/manage. Blocked until a business entity exists.

### 9.4 Facebook Pages (built in v1, live behind flag)
- **Requires**: second Meta app using Facebook Login for Business; the creator's FB Page (IG must be linked to a Page for the FB-login path — not needed for our separate IG app).
- **Scopes**: `pages_read_engagement` (+ `read_insights` for Page Insights).
- **Metrics v1**: Page followers (`followers_count` / `fan_count` profile fields).
- **Gated**: Page Insights (impressions, reach) unavailable below **100 Page likes**; metrics update ~once per 24h; history window limited to ~2 years.
- **Review gate**: same App Review + Business Verification as §9.3.

### 9.5 Platform summary

| Platform | Auth | v1 metric | Hard gate | Launch status |
|----------|------|-----------|-----------|---------------|
| YouTube | Google OAuth | Subscribers, videos | OAuth verification | Launch public after verification |
| TikTok | TikTok Login Kit | Followers, likes, videos | Product/scope approval | Launch public after approval |
| Instagram | IG Login (Meta app #1) | Followers | App Review + Business Verification | Flag-gated; entity required |
| Facebook | FB Login (Meta app #2) | Followers/fans | App Review + Business Verification | Flag-gated; entity required |

## 10. Security & compliance

- TLS everywhere; HSTS. CSRF `state` on all OAuth flows; PKCE where the platform supports it.
- Least-privilege scopes only. No write scopes. No content storage beyond display fields (handle, avatar).
- Tokens encrypted at rest; never logged; never sent to client.
- Privacy policy + Terms of Service pages (required by Google, Meta, TikTok reviews).
- Domain ownership verified (Google Search Console) for OAuth verification.
- Meta: data-deletion callback endpoint + status page required for review; user-initiated delete purges everything.
- Data minimization: aggregate counts + handles only. No commenter/audience data, no demographics in v1.
- Rate-limit hygiene: per-account cooldowns, exponential backoff with jitter, alerting on sustained 429/5xx.

## 11. Error handling & edge cases

- **Expired/revoked token** → mark `needs_reconnect`, banner on that platform's row, skip in future batches until reconnected. No retry storms.
- **Refresh failure** (TikTok >1yr inactivity; Instagram 60-day lapse) → same treatment; copy explains simply.
- **429 / quota exhausted** → backoff + jitter; defer remaining accounts to next run; alert at threshold (e.g., YT quota >80% used).
- **Partial batch failure** → per-account isolation; one bad account never blocks others.
- **Snapshot gaps** → charts show gaps; no interpolation. Delta math skips when <8 days history.
- **Reconnect race** → re-connect upserts by (user, platform, external_id); duplicate rows impossible.
- **Dormant accounts** (near-zero impressions) → Meta rate allowance may be near zero; tolerate occasional skips, show last-updated honestly.

## 12. Non-functional requirements

- Dashboard TTFB target < 300ms (DB-only render makes this easy).
- Snapshot job: the HTTP endpoint stays inside a provider's serverless time budget (~45s); the account loop runs in the scheduler, not the request handler. Scale via bounded per-run batches, not parallelism that risks rate limits. (The 1k-accounts figure is a scale ambition, not a per-request runtime target.)
- Uptime: dashboard is resilient to full platform API outages (serves last snapshots).
- Accessibility: WCAG AA contrast; large tap targets (mobile-first).
- Cost envelope: infra-only running cost target (free/low tiers) while user count is small.

## 13. Testing strategy

- **Adapter contract tests** (vitest): recorded fixtures built from each platform's documented sample payloads — auth exchange, refresh, profile fetch, error shapes. No live calls in CI.
- **Snapshot job tests**: idempotency (double run = one row), partial-failure isolation, date boundaries, timezone handling (store UTC).
- **Metrics math tests**: combined audience, 7-day delta with gaps, "building history" states.
- **Manual sandbox validation per platform**: YouTube test channel; TikTok dev app with own account; Meta test users under Standard Access.
- One framework (vitest), no test sprawl. Non-trivial logic ships with one runnable check minimum.

## 14. Phasing & launch checklist

**Current phase — PoC (hosted, ~zero cost)**
Goal: prove the spine end-to-end at ~zero cost, including one free-tier hosted environment so OAuth callbacks run against a real URL. No review submissions, no public launch.
- [ ] Auth, DB schema, adapter interface.
- [ ] All four adapters (YouTube, TikTok, Instagram, Facebook) in each platform's self-serve dev mode — owner's accounts.
- [ ] Daily snapshot run + combined-audience dashboard, served from our DB.
- [ ] One free-tier hosted environment (dev credentials only, no custom domain) for OAuth callbacks + volunteer validation.
- [ ] Volunteer validation: invited testers complete sign-in and connect ≥1 platform — qualitative feedback only.
- [ ] Done when: all four connect via OAuth; snapshots accumulate idempotently (≥8 days of history so the 7-day delta renders); dashboard renders solely from DB; gated metrics degrade gracefully; reconnect flow works.
- Deferred until after PoC: production hosting/cutover, the measured beta exit bar, review submissions, Business Verification + entity, privacy/terms pages, post-level metrics.

**Prerequisites (PoC).** The owner and every invited tester must hold: a Google account with a YouTube channel; a TikTok account; an **Instagram professional** (business/creator) account; a **Facebook Page**. Accounts lacking these cannot validate the corresponding adapter — a setup limit, not a product bug.

**Order & lead time (PoC).** dev apps/credentials → hosted environment → first adapter connects → snapshot core + a daily trigger pointed at the **hosted** DB (starts the clock) → ≥8 consecutive days of rows → volunteer validation → PoC exit. The 8-day history window is a hard calendar lead time: every day the daily trigger is not live is a day added to the end of the phase.

**Boundary — PoC validation vs beta exit (do not merge the two).** PoC volunteer validation is qualitative and unmeasured: no targets, no metrics. The measured bar — ≥3 testers with ≥2 platforms connected, 7-day return rate, >99% snapshot success — belongs to the post-PoC beta phase and is tracked there.

**Post-PoC — beta prep & submissions**
- [ ] Host the app; domain; privacy policy + ToS pages.
- [ ] Submit: Google OAuth verification (demo video), TikTok scope approval, Meta App Review + Business Verification (needs entity).
- [ ] Beta testers via platform test-user mechanisms. Collect "does the number feel right?" feedback.

**Post-PoC — P1 + Meta**
- [ ] P1: views-last-7-days where available (YT Analytics, IG reach, FB impressions, TikTok snapshot deltas), post-level "what worked" list (counts only).
- [ ] Meta platforms live per approval (flag-gated until then).

**Public launch**
- [ ] YouTube + TikTok public (after verification/approval); Meta flips on per review completion.
- [ ] Launch bar (distinct from the beta exit bar in the post-PoC checklist): define before launch — e.g. a user count and a 30-day retention figure — rather than restating the beta numbers.

## 15. Risks & open questions

| # | Item | Type | Notes |
|---|------|------|-------|
| 1 | No registered business entity | Post-PoC blocker | Owner-confirmed: register later. Blocks Meta Advanced Access (public launch); Meta stays flag-gated until then. PoC unaffected — Standard Access with own accounts. |
| 2 | Google verification turnaround | Risk | Stated ~3–5 business days; budget more; rejection = iterate on demo/privacy artifacts. |
| 3 | TikTok scope approval outcome | Risk | Weakest data of the four even if approved; communicate limits in UI honestly. |
| 4 | YT project-wide 10k quota shared by all users | Scaling risk | Fine to ~thousands of accounts; free extension via compliance audit. |
| 5 | YouTube Analytics API exact default quota | P1 | Analytics is a P1 source and `yt-analytics.readonly` is not requested in v1. Verify the quota when the P1 metric lands. |
| 6 | Whether `reports.query` also requires `youtube.readonly` | P1 | Verify alongside the P1 Analytics work, in the consent screen + live calls. |
| 7 | IG `followers_count` profile field availability under 100 followers | Verify in sandbox | Distinguished from the gated daily insights metric. |
| 8 | Monetization | Accepted | Free for now, revisit post-PoC (owner-confirmed). |
| 9 | Product name / domain | Deferred | 10 candidates suggested (Sumly, Crowdcount, Plainstats, Snapcount, Allcount, Reachly, Statbird, Oneboard, Statboard, Fanmeter); availability/trademark unchecked. Needed before public-launch artifacts. |
| 10 | Hosting | Partly resolved | PoC runs on one free-tier hosted environment (Vercel Hobby + Supabase free, dev credentials, no custom domain) so OAuth callbacks run against a real URL. Prod cutover decision (managed platform vs own VPS) still open before beta. |

## Appendix A — Verified facts (with sources)

All checked 2026-09-12 against primary docs:

- TikTok scopes incl. `user.info.stats` definitions — developers.tiktok.com/docs/en/tiktok-api-scopes
- TikTok video object fields, 6h cover URL TTL — developers.tiktok.com/docs/en/tiktok-api-v2-video-object
- TikTok token lifetimes (24h/1yr) + 12h refresh recommendation — developers.tiktok.com/docs/en/display-api-get-started
- YouTube Data API quota (10k units/day/project; per-method costs) — developers.google.com/youtube/v3/determine_quota_cost
- YouTube Analytics `reports.query` scopes + day-dimension data lag — developers.google.com/youtube/analytics/reference/reports/query
- Google sensitive scope verification requirements + testing exception — developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification
- Instagram: two login configs, mutual exclusivity, insights availability, rate-limit formula, Advanced Access + Business Verification requirement — developers.facebook.com/documentation/instagram-platform/overview
- Instagram Business Login token flow (1h → 60d, refresh rules) — developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login
- Instagram insights metrics list + <100 follower limitation — developers.facebook.com/documentation/instagram-platform/api-reference/instagram-user/insights
- App Review process (screencast, test credentials, privacy policy URL) — developers.facebook.com/documentation/instagram-platform/app-review
- Page Insights permissions + <100 likes limitation + 24h refresh + 2-year window — developers.facebook.com/docs/graph-api/reference/insights
- Vendor alternative pricing floor (~$199/mo) — getphyllo.com

## Appendix B — Decision log

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Build vs buy | Direct integrations (Approach A) | Free product; vendor per-account costs fatal; full data control |
| Data strategy | Daily snapshots, DB-only dashboard | Rate limits + TikTok has no history API; snapshots become the product's differentiator |
| Core view | One combined audience number + platform rows | User-approved; simplicity-first |
| Metric scope | Audience + growth v1 (owner-confirmed); views/post metrics P1 | YAGNI; keeps gating fallbacks small; TikTok has no account-level views API |
| Monetization | Free for now, revisit post-PoC | Owner decision; vendor path ruled out earlier |
| Naming | Deferred; 10 candidates | Domain/trademark checks pending; doesn't block PoC |
| Business entity | Register later | Meta stays flag-gated until then |
| Stack | Next.js + Supabase free tier + Vitest, local-first | Owner-approved; zero-cost PoC |
| Meta strategy | Two separate apps; ship behind flag | Login types mutually exclusive; no entity yet |
| Launch order | YouTube + TikTok public first | Only platforms whose gates are openable without an entity |

## Appendix C — Revision history

**Convention:** `0.x` = draft under review — minor bump (`0.1.0` → `0.2.0`) per revision round, patch bump for typo-level edits. `1.0.0` = approved baseline, referenceable by downstream plans. Filenames stay stable; the version lives in this table and the header. Downstream docs pin the FSD version they were written against.

| Version | Date | Author | Change |
|---------|------|--------|--------|
| 0.1.0 | 2026-09-12 | budigital | Initial draft. Design approved for implementation planning; platform constraints verified against primary docs. |
| 0.2.0 | 2026-09-12 | budigital | Corrected target-user framing: beginner-friendly is a design quality, not a user segment. Removed beginner scoping from §1, §2, §3; revised §8 rationale, §12 accessibility note, Appendix B rationale. |
| 0.3.0 | 2026-09-12 | budigital | Current phase reframed as local-first PoC (all four adapters, own accounts, no review submissions). Phasing reordered: PoC → beta/submissions → P1 + Meta → public launch. Risks 1/9/10 re-typed. |
| 1.0.0 | 2026-09-12 | budigital | Approved baseline. Owner confirmed: free for now; entity later; stack; two Meta apps; metrics = audience + growth only. Name/domain deferred (10 candidates, unchecked). |
| 1.1.0 | 2026-09-15 | budigital | PoC amended: one free-tier hosted environment (dev credentials, no custom domain) and invited-tester validation added to §14; explicit PoC-vs-beta-exit boundary; §15 risk 10 re-typed. |
| 1.2.0 | 2026-09-15 | budigital | Consultant review applied: PoC prerequisites + order/lead-time notes (§14); delta requires 8 days of history (§4); FR-6 rewritten; `yt-analytics.readonly` deferred to P1 (§9.1, §15 risks 5–6); snapshot runtime ceiling (§12); launch bar separated from the beta bar (§14). |
