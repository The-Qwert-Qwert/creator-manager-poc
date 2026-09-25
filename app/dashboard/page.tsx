import { redirect } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  ChartNoAxesColumn,
  Check,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleUserRound,
  Link2,
  TrendingUp,
  Clock3,
  LogOut,
  Music2,
  RefreshCw,
} from "lucide-react";

import type { SVGProps } from "react";

import { refreshAccount } from "./actions";
import { Sparkline } from "./sparkline";
import { ThemeToggle } from "./theme-toggle";
import "./dashboard.css";

import { PLATFORMS, type AccountStatus, type Platform } from "@/lib/adapters/types";
import { requireUser } from "@/lib/auth/session";
import { config } from "@/lib/config";
import { createClient } from "@/lib/supabase/server";
import {
  DELTA_NOTES,
  DELTA_PLACEHOLDER,
  DELTA_WINDOW_DAYS,
  SNAPSHOT_FETCH_LIMIT,
  SPARKLINE_POINTS,
  buildDashboardMetrics,
  type Delta,
  type SnapshotPoint,
} from "@/lib/dashboard/metrics";
import { cooldownLabel, cooldownRemainingMs } from "@/lib/dashboard/manual-refresh";

const MS_PER_DAY = 86_400_000;

interface DashboardPageProps {
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
}

interface PlatformMeta {
  name: string;
  audienceLabel: string;
}

const PLATFORM_INFO: Record<Platform, PlatformMeta> = {
  youtube: { name: "YouTube", audienceLabel: "Subscribers" },
  tiktok: { name: "TikTok", audienceLabel: "Followers" },
  instagram: { name: "Instagram", audienceLabel: "Followers" },
  facebook: { name: "Facebook", audienceLabel: "Followers" },
};

function PlatformIcon({ platform, size = 21 }: { platform: Platform; size?: number }) {
  const sharedProps = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    xmlns: "http://www.w3.org/2000/svg",
  } satisfies SVGProps<SVGSVGElement>;

  if (platform === "youtube") {
    return (
      <svg {...sharedProps} viewBox="0 0 24 24" fill="currentColor">
        <path d="M21.58 7.19a2.5 2.5 0 0 0-1.76-1.77C18.25 5 12 5 12 5s-6.25 0-7.82.42a2.5 2.5 0 0 0-1.76 1.77A26.1 26.1 0 0 0 2 12a26.1 26.1 0 0 0 .42 4.81 2.5 2.5 0 0 0 1.76 1.77C5.75 19 12 19 12 19s6.25 0 7.82-.42a2.5 2.5 0 0 0 1.76-1.77A26.1 26.1 0 0 0 22 12a26.1 26.1 0 0 0-.42-4.81ZM10 15.02V8.98L15.2 12 10 15.02Z" />
      </svg>
    );
  }

  if (platform === "instagram") {
    return (
      <svg {...sharedProps} stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="18" height="18" rx="5" />
        <circle cx="12" cy="12" r="4" />
        <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
      </svg>
    );
  }

  if (platform === "facebook") {
    return (
      <svg {...sharedProps} fill="currentColor">
        <path d="M14.2 8.1V6.7c0-.7.5-1 1-1h2.5V2.2L14.5 2C11.4 2 9.9 3.6 9.9 6v2.1H7.3V12h2.6v9.8h4.3V12h2.8l.4-3.9h-3.2V8.1Z" />
      </svg>
    );
  }

  return <Music2 aria-hidden="true" width={size} height={size} strokeWidth={2.2} />;
}

const STATUS_INFO: Record<AccountStatus, { label: string; tone: "success" | "warning" }> = {
  active: { label: "Active", tone: "success" },
  needs_reconnect: { label: "Needs reconnect", tone: "warning" },
  revoked: { label: "Access revoked", tone: "warning" },
};

const REFRESH_ERROR_MESSAGES: Record<string, string> = {
  cooldown: "That account was already refreshed in the last hour. You can refresh it again shortly.",
  expired: "The platform no longer accepts the saved login for that account. Reconnect it to continue.",
  rate_limited: "The platform is rate-limiting us right now. The next scheduled run will pick it up.",
  not_found: "The platform couldn't find a profile for that account.",
  failed: "We couldn't refresh that account just now.",
};

function formatUpdated(capturedOn: string | null, now: Date): string {
  if (!capturedOn) {
    return "No snapshots yet";
  }

  const today = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  const captured = Date.parse(`${capturedOn.slice(0, 10)}T00:00:00Z`);
  const days = Math.round((today - captured) / MS_PER_DAY);

  if (days <= 0) return "Updated today";
  if (days === 1) return "Updated yesterday";
  return `Updated ${days} days ago`;
}

function DeltaSummary({
  delta,
  compact = false,
  className = "",
}: {
  delta: Delta;
  compact?: boolean;
  className?: string;
}) {
  if (!delta.available) {
    return (
      <span className={`delta-pill delta-pill--muted ${className}`}>
        {DELTA_PLACEHOLDER} <span className="sr-only">{DELTA_NOTES[delta.reason]}</span>
      </span>
    );
  }

  const positive = delta.value > 0;
  const negative = delta.value < 0;
  const DeltaIcon = positive ? ArrowUp : negative ? ArrowDown : null;
  const tone = positive ? "positive" : negative ? "negative" : "neutral";
  const label = compact
    ? `${delta.value > 0 ? "+" : delta.value < 0 ? "−" : ""}${Math.abs(delta.value).toLocaleString()} · 7d`
    : `${delta.value > 0 ? "+" : delta.value < 0 ? "−" : ""}${Math.abs(delta.value).toLocaleString()} vs ${DELTA_WINDOW_DAYS} days ago`;

  return (
    <span className={`delta-pill delta-pill--${tone} ${className}`}>
      {DeltaIcon && <DeltaIcon aria-hidden="true" size={compact ? 12 : 15} strokeWidth={2.25} />}
      <span aria-hidden="true">{label}</span>
      <span className="sr-only">
        {positive ? "Up" : negative ? "Down" : "No change"} {Math.abs(delta.value).toLocaleString()} versus {DELTA_WINDOW_DAYS} days ago
      </span>
    </span>
  );
}

function GrowthChip({ delta, currentTotal }: { delta: Delta; currentTotal: number }) {
  if (!delta.available) {
    return <span className="delta-pill delta-pill--muted trend-chip">{DELTA_PLACEHOLDER}</span>;
  }

  const previousTotal = currentTotal - delta.value;
  if (previousTotal <= 0) {
    return <span className="delta-pill delta-pill--neutral trend-chip">—</span>;
  }

  const percentage = (delta.value / previousTotal) * 100;
  const tone = percentage > 0 ? "positive" : percentage < 0 ? "negative" : "neutral";
  return (
    <span className={`delta-pill delta-pill--${tone} trend-chip`}>
      {percentage > 0 ? "+" : percentage < 0 ? "−" : ""}{Math.abs(percentage).toFixed(1)}%
      <span className="sr-only">Audience change versus {DELTA_WINDOW_DAYS} days ago</span>
    </span>
  );
}

function StatusChip({ status }: { status: AccountStatus }) {
  const info = STATUS_INFO[status];
  const StatusIcon = info.tone === "success" ? CircleCheck : CircleAlert;

  return (
    <span className={`status-chip status-chip--${info.tone}`}>
      <StatusIcon aria-hidden="true" size={13} strokeWidth={2.2} />
      {info.label}
    </span>
  );
}

function PlatformBadge({ platform, size = "default" }: { platform: Platform; size?: "default" | "small" | "tiny" }) {
  const sizeClass = size === "default" ? "" : ` platform-badge--${size}`;
  const iconSize = size === "default" ? 21 : size === "small" ? 17 : 14;

  return (
    <span className={`platform-badge platform-badge--${platform}${sizeClass}`} aria-hidden="true">
      <PlatformIcon platform={platform} size={iconSize} />
    </span>
  );
}

function CombinedTrendChart({ rows }: { rows: readonly { sparkline: SnapshotPoint[] }[] }) {
  const combinedByDate = new Map<string, number>();
  for (const row of rows) {
    for (const point of row.sparkline) {
      combinedByDate.set(
        point.capturedOn.slice(0, 10),
        (combinedByDate.get(point.capturedOn.slice(0, 10)) ?? 0) + point.audienceCount,
      );
    }
  }
  const points = [...combinedByDate.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([capturedOn, audienceCount]) => ({ capturedOn, audienceCount }));
  const chartWidth = 420;
  const chartHeight = 168;

  if (points.length < 2) {
    return <div className="sparkline-frame combined-chart-empty" aria-label="Combined audience trend appears after a couple of days." />;
  }

  const minimum = Math.min(...points.map((point) => point.audienceCount));
  const maximum = Math.max(...points.map((point) => point.audienceCount));
  const span = maximum - minimum || 1;
  const line = points
    .map((point, index) => {
      const x = (index / (points.length - 1)) * chartWidth;
      const y = chartHeight - 4 - ((point.audienceCount - minimum) / span) * (chartHeight - 8);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg className="combined-chart" viewBox={`0 0 ${chartWidth} ${chartHeight}`} preserveAspectRatio="none" role="img" aria-label="Audience trend across connected platforms over the last 30 days.">
      <defs>
        <linearGradient id="combined-chart-gradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--chart-line)" stopOpacity="0.2" />
          <stop offset="100%" stopColor="var(--chart-line)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon className="combined-chart-area" points={`0,${chartHeight} ${line} ${chartWidth},${chartHeight}`} />
      <polyline className="combined-chart-line" points={line} />
    </svg>
  );
}

export default async function DashboardPage(props: DashboardPageProps) {
  const { user, supabase } = await requireUser();

  const searchParams = props.searchParams ? await props.searchParams : {};
  const readParam = (key: string): string | undefined => {
    const value = searchParams[key];
    return typeof value === "string" ? value : undefined;
  };

  const connectedPlatform = readParam("connected");
  const deniedPlatform = readParam("denied");
  const errorParam = readParam("error");
  const refreshedPlatform = readParam("refreshed");
  const refreshError = readParam("refresh");

  const { data: rawAccounts } = await supabase
    .from("connected_accounts")
    .select(
      "id, platform, handle, status, last_manual_refresh_at, metric_snapshots(audience_count, captured_on)",
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .order("captured_on", { referencedTable: "metric_snapshots", ascending: false })
    .limit(SNAPSHOT_FETCH_LIMIT, { referencedTable: "metric_snapshots" });

  const accounts = (rawAccounts ?? []).filter((account) => {
    if (
      !config.features.enableMeta &&
      (account.platform === "instagram" || account.platform === "facebook")
    ) {
      return false;
    }
    return true;
  });

  const connectablePlatforms = PLATFORMS.filter((platform) => {
    if (
      !config.features.enableMeta &&
      (platform === "instagram" || platform === "facebook")
    ) {
      return false;
    }
    return true;
  });

  const now = new Date();
  const metrics = buildDashboardMetrics(
    accounts.map((account) => ({
      id: account.id,
      platform: account.platform as Platform,
      handle: account.handle,
      avatarUrl: null,
      status: account.status as AccountStatus,
      snapshots: (account.metric_snapshots ?? []).map((snapshot) => ({
        capturedOn: snapshot.captured_on,
        audienceCount: snapshot.audience_count,
      })),
    })),
  );

  const cooldowns = new Map<string, number>(
    accounts.map((account) => [
      account.id,
      cooldownRemainingMs(account.last_manual_refresh_at, now),
    ]),
  );

  const hasAnyAudience = metrics.rows.some((row) => row.audienceCount !== null);

  async function signOut() {
    "use server";
    const supabaseClient = await createClient();
    await supabaseClient.auth.signOut();
    redirect("/auth/sign-in");
  }

  return (
    <div className="dashboard-page">
      <div className="dashboard-shell">
        <header className="app-bar">
          <div className="app-bar-inner">
            <div className="brand">
              <span className="brand-mark"><ChartNoAxesColumn aria-hidden="true" size={20} strokeWidth={2.2} /></span>
              <div className="brand-copy">
                <p className="brand-name">Creator Analytics</p>
                <p className="brand-tagline">All your platforms, one number</p>
              </div>
            </div>

            <div className="app-bar-actions">
              <ThemeToggle />
              <div className="user-chip">
                <CircleUserRound aria-hidden="true" size={16} />
                <span title={user.email}>{user.email}</span>
              </div>
              <form action={signOut}>
                <button type="submit" className="icon-button">
                  <LogOut aria-hidden="true" size={15} />
                  Sign out
                </button>
              </form>
            </div>
            <div className="app-bar-actions mobile-app-actions">
              <ThemeToggle />
              <span className="mobile-avatar" aria-hidden="true"><CircleUserRound size={17} /></span>
            </div>
          </div>
        </header>

        <main className="dashboard-content">
          {(connectedPlatform || refreshedPlatform || refreshError || deniedPlatform || errorParam) && (
            <div className="feedback-stack">
              {connectedPlatform && (
                <div className="feedback-banner feedback-banner--success" role="status">
                  <Check aria-hidden="true" size={16} />
                  <div className="banner-copy"><strong>Connected!</strong> Successfully connected your <strong>{PLATFORM_INFO[connectedPlatform as Platform]?.name || connectedPlatform}</strong> account.</div>
                </div>
              )}
              {refreshedPlatform && (
                <div className="feedback-banner feedback-banner--success" role="status">
                  <Check aria-hidden="true" size={16} />
                  <div className="banner-copy"><strong>Refreshed.</strong> Pulled the latest numbers for your <strong>{PLATFORM_INFO[refreshedPlatform as Platform]?.name || refreshedPlatform}</strong> account.</div>
                </div>
              )}
              {refreshError && (
                <div className="feedback-banner feedback-banner--warning" role="alert">
                  <CircleAlert aria-hidden="true" size={16} />
                  <div className="banner-copy">{REFRESH_ERROR_MESSAGES[refreshError] ?? REFRESH_ERROR_MESSAGES.failed}</div>
                </div>
              )}
              {deniedPlatform && (
                <div className="feedback-banner feedback-banner--warning" role="alert">
                  <CircleAlert aria-hidden="true" size={16} />
                  <div className="banner-copy"><strong>Connection cancelled:</strong> Access was denied or cancelled for <strong>{PLATFORM_INFO[deniedPlatform as Platform]?.name || deniedPlatform}</strong>.</div>
                </div>
              )}
              {errorParam && (
                <div className="feedback-banner feedback-banner--error" role="alert">
                  <CircleAlert aria-hidden="true" size={16} />
                  <div className="banner-copy"><strong>Connection error:</strong> {formatErrorMessage(errorParam)}</div>
                </div>
              )}
            </div>
          )}

          <div className="audience-layout">
            <section className="hero-summary" aria-labelledby="audience-heading">
              <h2 className="eyebrow" id="audience-heading">{metrics.combinedAudienceLabel}</h2>
              <p className="audience-value">{hasAnyAudience ? metrics.combinedAudience.toLocaleString() : DELTA_PLACEHOLDER}</p>
              <DeltaSummary delta={metrics.delta} />
              <p className="audience-note">One person can follow you on more than one platform, so this is a total count, not unique people.</p>
              <div className="hero-footer"><Clock3 aria-hidden="true" size={13} /> Numbers update once a day, at about 6am.</div>
            </section>
            <section className="trend-card trend-panel" aria-label="Growth over the last 30 days">
              <div className="trend-header">
                <h3 className="trend-title">Growth, last 30 days</h3>
                <GrowthChip delta={metrics.delta} currentTotal={metrics.combinedAudience} />
              </div>
              <CombinedTrendChart rows={metrics.rows} />
              <div className="chart-footer"><span>30 days ago</span><span>Today</span></div>
            </section>
          </div>

          <section className="platforms-section" aria-labelledby="accounts-heading">
            <div className="section-header">
              <div className="section-heading-copy">
                <h2 className="section-title" id="accounts-heading">Your platforms</h2>
                <p className="section-subtitle">Each row is one account. Refresh pulls today&apos;s numbers early.</p>
              </div>
              <span className="count-pill">{metrics.rows.length} connected</span>
            </div>

            {metrics.rows.length === 0 ? (
              <div className="empty-state"><p>No platforms connected yet. Connect one below — we&apos;ll start recording a daily snapshot from today.</p></div>
            ) : (
              <ul className="account-list">
                {metrics.rows.map((row) => {
                  const meta = PLATFORM_INFO[row.platform];
                  const remaining = cooldowns.get(row.id) ?? 0;
                  const isReconnectable = row.status !== "active";

                  return (
                    <li key={row.id} className={isReconnectable ? "account-card account-card--reconnectable" : "account-card"}>
                      {isReconnectable && (
                        <div className="reconnect-banner">
                          <CircleAlert aria-hidden="true" size={15} />
                          <div className="reconnect-banner-copy">
                            <strong>{meta.name} {row.status === "revoked" ? "access was revoked — reconnect" : "connection expired — reconnect"}</strong>
                            <p>We keep showing the last numbers we captured until you do.</p>
                          </div>
                          <a href={`/api/auth/${row.platform}`} className="primary-button" aria-label={`Reconnect ${meta.name}`}>Reconnect</a>
                        </div>
                      )}

                      <div className="account-identity">
                        <PlatformBadge platform={row.platform} />
                        <div className="identity-copy">
                          <p className="platform-name">{meta.name}</p>
                          <p className="account-handle">{row.handle.startsWith("@") || row.platform === "facebook" ? row.handle : `@${row.handle}`}</p>
                        </div>
                      </div>

                      <div className="account-metric">
                        <p className="account-value">{row.audienceCount === null ? DELTA_PLACEHOLDER : row.audienceCount.toLocaleString()}</p>
                        <p className="audience-label">{meta.audienceLabel}</p>
                        <DeltaSummary className="mobile-row-delta" delta={row.delta} compact />
                      </div>

                      <div className="account-trend">
                        <div className="sparkline-frame"><Sparkline points={row.sparkline} platformLabel={meta.name} /></div>
                        <p className="trend-caption">Last {SPARKLINE_POINTS} days</p>
                      </div>

                      <div className="account-status">
                        <StatusChip status={row.status} />
                        <p className="updated-time">
                          {row.lastUpdated ? <time dateTime={row.lastUpdated}>{formatUpdated(row.lastUpdated, now)}</time> : formatUpdated(row.lastUpdated, now)}
                        </p>
                        {row.gatedNotice && <p className="gated-notice">{row.gatedNotice}</p>}
                        <DeltaSummary className="desktop-row-delta" delta={row.delta} compact />
                      </div>

                      <div className="account-actions">
                        <form action={refreshAccount}>
                          <input type="hidden" name="accountId" value={row.id} />
                          <button type="submit" disabled={remaining > 0} className="secondary-button icon-button" aria-label={remaining > 0 ? cooldownLabel(remaining) : `Refresh ${meta.name} account now`}>
                            <RefreshCw aria-hidden="true" size={15} />
                            {remaining > 0 ? cooldownLabel(remaining) : "Refresh"}
                          </button>
                        </form>
                        <span className="action-hint">Once an hour</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="connect-section" aria-labelledby="connect-heading">
            <div className="section-header">
              <div className="section-heading-copy">
                <h2 className="section-title" id="connect-heading">Connect another platform</h2>
                <p className="section-subtitle">One platform is enough to be useful — add more whenever you like.</p>
              </div>
            </div>
            <div className="connect-grid">
              {connectablePlatforms.map((platform) => {
                const meta = PLATFORM_INFO[platform];
                const isConnected = accounts.some((account) => account.platform === platform);
                return (
                  <article key={platform} className="connect-card">
                    <div className="connect-card-header">
                      <PlatformBadge platform={platform} size="small" />
                      <strong className="connect-card-name">{meta.name}</strong>
                    </div>
                    <div className="connect-card-footer">
                      {isConnected ? <span className="connected-chip"><Check aria-hidden="true" size={12} /> Connected</span> : <span />}
                      <a href={`/api/auth/${platform}`} className="icon-button mobile-connect-action" aria-label={isConnected ? `Reconnect ${meta.name}` : `Connect ${meta.name}`}>
                        {isConnected ? <Link2 aria-hidden="true" className="desktop-connect-icon" size={15} /> : <TrendingUp aria-hidden="true" className="desktop-connect-icon" size={15} />}
                        <span className="desktop-connect-label">{isConnected ? "Reconnect" : "Connect"}</span>
                        <span className="mobile-connect-platform"><PlatformBadge platform={platform} size="tiny" /></span>
                        <span className="mobile-connect-label">{isConnected ? `Reconnect ${meta.name}` : `Connect ${meta.name}`}</span>
                        <ChevronRight aria-hidden="true" className="mobile-connect-chevron" size={15} />
                      </a>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        </main>

        <footer className="dashboard-footer">
          <div className="dashboard-footer-inner">
            <p>Creator Analytics · PoC v0.1.0</p>
            <div className="footer-links"><span>Privacy</span><span>Terms</span><span>Help</span></div>
          </div>
        </footer>
      </div>
    </div>
  );
}

function formatErrorMessage(code: string): string {
  switch (code) {
    case "missing_credentials":
      return "OAuth credentials for this platform are not configured.";
    case "auth_start_failed":
      return "Failed to initiate OAuth flow for this platform.";
    case "invalid_state":
      return "The session expired or was invalid. Please try again.";
    case "exchange_failed":
      return "Failed to exchange authorization code with the provider.";
    case "db_error":
      return "Failed to save account details to the database.";
    case "missing_code_or_state":
      return "Missing authorization parameters from the platform.";
    default:
      return code;
  }
}
