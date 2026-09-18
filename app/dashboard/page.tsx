import { redirect } from "next/navigation";
import type { CSSProperties } from "react";

import { refreshAccount } from "./actions";
import { Sparkline } from "./sparkline";

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
} from "@/lib/dashboard/metrics";
import { cooldownLabel, cooldownRemainingMs } from "@/lib/dashboard/manual-refresh";

const MS_PER_DAY = 86_400_000;

interface DashboardPageProps {
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
}

interface PlatformMeta {
  name: string;
  icon: string;
  iconBg: string;
  audienceLabel: string;
}

const PLATFORM_INFO: Record<Platform, PlatformMeta> = {
  youtube: {
    name: "YouTube",
    icon: "▶",
    iconBg: "#dc2626",
    audienceLabel: "Subscribers",
  },
  tiktok: {
    name: "TikTok",
    icon: "♪",
    iconBg: "#000000",
    audienceLabel: "Followers",
  },
  instagram: {
    name: "Instagram",
    icon: "IG",
    iconBg: "linear-gradient(45deg, #f59e0b, #e11d48, #7c3aed)",
    audienceLabel: "Followers",
  },
  facebook: {
    name: "Facebook",
    icon: "f",
    iconBg: "#2563eb",
    audienceLabel: "Followers",
  },
};

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

function DeltaSummary({ delta }: { delta: Delta }) {
  if (!delta.available) {
    return (
      <p style={styles.deltaMuted}>
        <span aria-hidden="true">{DELTA_PLACEHOLDER}</span> {DELTA_NOTES[delta.reason]}
      </p>
    );
  }

  const direction = delta.value > 0 ? "Up" : delta.value < 0 ? "Down" : "No change";

  return (
    <p
      style={{
        ...styles.delta,
        color:
          delta.value > 0
            ? "var(--success)"
            : delta.value < 0
              ? "var(--danger)"
              : "var(--muted)",
      }}
    >
      <span aria-hidden="true">
        {delta.value > 0 ? "▲ " : delta.value < 0 ? "▼ " : ""}
        {delta.value > 0 ? "+" : delta.value < 0 ? "−" : ""}
        {Math.abs(delta.value).toLocaleString()}
      </span>
      <span style={styles.deltaCaption} aria-hidden="true"> vs {DELTA_WINDOW_DAYS} days ago</span>
      <span style={styles.srOnly}>{`${direction} ${Math.abs(delta.value).toLocaleString()} versus ${DELTA_WINDOW_DAYS} days ago`}</span>
    </p>
  );
}

function StatusChip({ status }: { status: AccountStatus }) {
  const info = STATUS_INFO[status];

  return (
    <span
      style={{
        ...styles.statusChip,
        color: `var(--${info.tone})`,
        backgroundColor: `var(--${info.tone}-soft)`,
      }}
    >
      {info.label}
    </span>
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

  // FR-4: the dashboard reads our DB only. No platform API is called on render.
  // One embedded query: each account with its newest snapshots, so an account
  // whose newest snapshot is older than the sparkline window still shows a value.
  const { data: rawAccounts } = await supabase
    .from("connected_accounts")
    .select(
      "id, platform, handle, status, last_manual_refresh_at, metric_snapshots(audience_count, captured_on)",
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .order("captured_on", { referencedTable: "metric_snapshots", ascending: false })
    .limit(SNAPSHOT_FETCH_LIMIT, { referencedTable: "metric_snapshots" });

  // Flag-gated until Meta approval (CREAT-23)
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
    <div style={styles.pageWrap}>
      <main style={styles.card}>
        <header style={styles.header}>
          <div>
            <div style={styles.titleRow}>
              <h1 style={styles.title}>Creator Analytics</h1>
              <span style={styles.versionBadge}>PoC v0.1.0</span>
            </div>
            <p style={styles.subtitle}>
              Signed in as{" "}
              <strong style={{ color: "var(--foreground)" }}>{user.email}</strong>
            </p>
          </div>
          <form action={signOut}>
            <button type="submit" style={styles.signOutBtn}>
              Sign out
            </button>
          </form>
        </header>

        {connectedPlatform && (
          <div style={styles.bannerSuccess} role="status">
            <span style={styles.bannerIcon} aria-hidden="true">
              ✓
            </span>
            <div>
              <strong>Connected!</strong> Successfully connected your{" "}
              <strong>
                {PLATFORM_INFO[connectedPlatform as Platform]?.name || connectedPlatform}
              </strong>{" "}
              account.
            </div>
          </div>
        )}

        {refreshedPlatform && (
          <div style={styles.bannerSuccess} role="status">
            <span style={styles.bannerIcon} aria-hidden="true">
              ✓
            </span>
            <div>
              <strong>Refreshed.</strong> Pulled the latest numbers for your{" "}
              <strong>
                {PLATFORM_INFO[refreshedPlatform as Platform]?.name || refreshedPlatform}
              </strong>{" "}
              account.
            </div>
          </div>
        )}

        {refreshError && (
          <div style={styles.bannerWarning} role="alert">
            <span style={styles.bannerIcon} aria-hidden="true">
              ⚠
            </span>
            <div>
              {REFRESH_ERROR_MESSAGES[refreshError] ?? REFRESH_ERROR_MESSAGES.failed}
            </div>
          </div>
        )}

        {deniedPlatform && (
          <div style={styles.bannerWarning} role="alert">
            <span style={styles.bannerIcon} aria-hidden="true">
              ⚠
            </span>
            <div>
              <strong>Connection cancelled:</strong> Access was denied or cancelled for{" "}
              <strong>
                {PLATFORM_INFO[deniedPlatform as Platform]?.name || deniedPlatform}
              </strong>
              .
            </div>
          </div>
        )}

        {errorParam && (
          <div style={styles.bannerError} role="alert">
            <span style={styles.bannerIcon} aria-hidden="true">
              ✕
            </span>
            <div>
              <strong>Connection error:</strong> {formatErrorMessage(errorParam)}. Please try again.
            </div>
          </div>
        )}

        {/* Combined audience — FSD §6 */}
        <section style={styles.summary} aria-labelledby="audience-heading">
          <h2 id="audience-heading" style={styles.summaryLabel}>
            {metrics.combinedAudienceLabel}
          </h2>
          <p style={styles.summaryValue}>
            {hasAnyAudience ? metrics.combinedAudience.toLocaleString() : DELTA_PLACEHOLDER}
          </p>
          <DeltaSummary delta={metrics.delta} />
          <p style={styles.summaryNote}>{metrics.combinedAudienceNote}</p>
        </section>

        {/* Per-platform rows — FR-4, FR-6, FR-10 */}
        <section style={styles.section} aria-labelledby="accounts-heading">
          <div style={styles.sectionHeaderRow}>
            <h2 id="accounts-heading" style={styles.sectionTitle}>
              Your platforms
            </h2>
            <span style={styles.countBadge}>
              {accounts.length} {accounts.length === 1 ? "account" : "accounts"}
            </span>
          </div>

          {metrics.rows.length === 0 ? (
            <div style={styles.emptyState}>
              <p style={styles.emptyText}>
                No platforms connected yet. Connect one below — we&apos;ll start recording a
                daily snapshot from today.
              </p>
            </div>
          ) : (
            <ul style={styles.accountList}>
              {metrics.rows.map((row) => {
                const meta = PLATFORM_INFO[row.platform];
                const remaining = cooldowns.get(row.id) ?? 0;
                const isReconnectable = row.status !== "active";

                return (
                  <li key={row.id} style={styles.accountRow}>
                    {isReconnectable && (
                      <div style={styles.reconnectBanner}>
                        <span style={styles.bannerIcon} aria-hidden="true">
                          ⚠
                        </span>
                        <div style={styles.reconnectCopy}>
                          <strong>
                            {meta.name}{" "}
                            {row.status === "revoked"
                              ? "access was revoked — reconnect"
                              : "connection expired — reconnect"}
                          </strong>
                          <p style={styles.reconnectNote}>
                            We keep showing the last numbers we captured until you do.
                          </p>
                        </div>
                        <a
                          href={`/api/auth/${row.platform}`}
                          style={styles.buttonPrimary}
                          aria-label={`Reconnect ${meta.name}`}
                        >
                          Reconnect {meta.name}
                        </a>
                      </div>
                    )}

                    <div style={styles.identity}>
                      <span
                        style={{ ...styles.platformIcon, background: meta.iconBg }}
                        aria-hidden="true"
                      >
                        {meta.icon}
                      </span>
                      <div>
                        <p style={styles.accountName}>{meta.name}</p>
                        <p style={styles.accountHandle}>@{row.handle}</p>
                      </div>
                    </div>

                    <div style={styles.metricBlock}>
                      <p style={styles.metricValue}>
                        {row.audienceCount === null ? DELTA_PLACEHOLDER : row.audienceCount.toLocaleString()}
                      </p>
                      <p style={styles.metricLabel}>{meta.audienceLabel}</p>
                      <DeltaSummary delta={row.delta} />
                    </div>

                    <div style={styles.trendBlock}>
                      <Sparkline points={row.sparkline} platformLabel={meta.name} />
                      <p style={styles.trendCaption}>Last {SPARKLINE_POINTS} days</p>
                    </div>

                    <div style={styles.metaBlock}>
                      <StatusChip status={row.status} />
                      <p style={styles.lastUpdated}>
                        {row.lastUpdated ? (
                          <time dateTime={row.lastUpdated}>
                            {formatUpdated(row.lastUpdated, now)}
                          </time>
                        ) : (
                          formatUpdated(row.lastUpdated, now)
                        )}
                      </p>
                      {row.gatedNotice && <p style={styles.gatedNotice}>{row.gatedNotice}</p>}

                      <form action={refreshAccount} style={styles.refreshForm}>
                        <input type="hidden" name="accountId" value={row.id} />
                        <button
                          type="submit"
                          disabled={remaining > 0}
                          style={remaining > 0 ? styles.buttonDisabled : styles.buttonSecondary}
                          aria-label={remaining > 0 ? cooldownLabel(remaining) : `Refresh ${meta.name} account now`}
                        >
                          {remaining > 0 ? cooldownLabel(remaining) : "Refresh now"}
                        </button>
                      </form>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Connect platforms — CREAT-23 */}
        <section style={styles.section} aria-labelledby="connect-heading">
          <div style={styles.sectionHeaderRow}>
            <h2 id="connect-heading" style={styles.sectionTitle}>
              Connect more platforms
            </h2>
          </div>
          <p style={styles.sectionDesc}>
            One platform is enough to be useful — connect more whenever you like.
          </p>

          <div style={styles.connectGrid}>
            {connectablePlatforms.map((platform) => {
              const meta = PLATFORM_INFO[platform];
              const isConnected = accounts.some((account) => account.platform === platform);

              return (
                <div key={platform} style={styles.connectCard}>
                  <div style={styles.cardHeader}>
                    <div style={styles.platformBadgeWrap}>
                      <span style={{ ...styles.platformIcon, background: meta.iconBg }} aria-hidden="true">
                        {meta.icon}
                      </span>
                      <strong style={styles.platformName}>{meta.name}</strong>
                    </div>
                    {isConnected && <span style={styles.connectedBadge}>Connected</span>}
                  </div>

                  <div style={{ marginTop: "auto", paddingTop: "0.75rem" }}>
                    <a
                      href={`/api/auth/${platform}`}
                      style={isConnected ? styles.reconnectBtn : styles.connectBtn}
                      aria-label={isConnected ? `Reconnect ${meta.name}` : `Connect ${meta.name}`}
                    >
                      {isConnected ? "Reconnect" : `Connect ${meta.name}`}
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </main>
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

const styles = {
  pageWrap: {
    maxWidth: 960,
    margin: "0 auto",
    padding: "2.5rem 1rem",
  },
  card: {
    backgroundColor: "var(--card)",
    color: "var(--foreground)",
    border: "1px solid var(--border)",
    borderRadius: 16,
    padding: "1.75rem",
    boxShadow: "0 1px 3px rgba(0, 0, 0, 0.05)",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "1.5rem",
    borderBottom: "1px solid var(--border)",
    paddingBottom: "1.25rem",
    flexWrap: "wrap",
    gap: "1rem",
  },
  titleRow: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    flexWrap: "wrap",
  },
  title: {
    margin: 0,
    fontSize: "1.5rem",
    fontWeight: 700,
    letterSpacing: "-0.02em",
  },
  versionBadge: {
    fontSize: "0.75rem",
    fontWeight: 600,
    padding: "0.15rem 0.5rem",
    borderRadius: 9999,
    backgroundColor: "rgba(37, 99, 235, 0.1)",
    color: "var(--primary)",
  },
  subtitle: {
    margin: "0.35rem 0 0",
    color: "var(--muted)",
    fontSize: "0.875rem",
  },
  signOutBtn: {
    minHeight: 44,
    padding: "0.45rem 0.9rem",
    border: "1px solid var(--border)",
    borderRadius: 8,
    backgroundColor: "transparent",
    cursor: "pointer",
    fontSize: "0.8125rem",
    fontWeight: 500,
    color: "var(--foreground)",
  },
  section: {
    marginBottom: "2rem",
  },
  sectionHeaderRow: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: "0.75rem",
    flexWrap: "wrap",
  },
  sectionTitle: {
    fontSize: "1.125rem",
    margin: 0,
    fontWeight: 600,
  },
  sectionDesc: {
    margin: "0.25rem 0 0.85rem",
    color: "var(--muted)",
    fontSize: "0.8125rem",
  },
  countBadge: {
    fontSize: "0.75rem",
    color: "var(--muted)",
  },
  summary: {
    border: "1px solid var(--border)",
    borderRadius: 14,
    padding: "1.25rem 1.35rem",
    backgroundColor: "var(--muted-background)",
    marginBottom: "2rem",
  },
  summaryLabel: {
    margin: 0,
    fontSize: "0.875rem",
    fontWeight: 600,
    color: "var(--muted)",
  },
  summaryValue: {
    margin: "0.35rem 0 0.15rem",
    fontSize: "2.75rem",
    fontWeight: 700,
    letterSpacing: "-0.03em",
    lineHeight: 1.1,
    fontVariantNumeric: "tabular-nums",
  },
  summaryNote: {
    margin: "0.6rem 0 0",
    fontSize: "0.75rem",
    color: "var(--muted)",
    maxWidth: "48ch",
  },
  delta: {
    margin: "0.25rem 0 0",
    fontSize: "0.875rem",
    fontWeight: 600,
  },
  deltaMuted: {
    margin: "0.25rem 0 0",
    fontSize: "0.8125rem",
    fontWeight: 500,
    color: "var(--muted)",
  },
  deltaCaption: {
    fontWeight: 400,
    color: "var(--muted)",
  },
  srOnly: {
    position: "absolute",
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: "hidden",
    clipPath: "inset(50%)",
    whiteSpace: "nowrap",
    border: 0,
  },
  accountList: {
    listStyle: "none",
    margin: "0.85rem 0 0",
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: "0.85rem",
  },
  accountRow: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
    gap: "1rem",
    alignItems: "center",
    border: "1px solid var(--border)",
    borderRadius: 14,
    padding: "1rem 1.15rem",
  },
  reconnectBanner: {
    gridColumn: "1 / -1",
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
    flexWrap: "wrap",
    backgroundColor: "var(--warning-soft)",
    border: "1px solid var(--warning)",
    borderRadius: 10,
    padding: "0.7rem 0.85rem",
    color: "var(--warning)",
    fontSize: "0.8125rem",
  },
  reconnectCopy: {
    flex: "1 1 220px",
  },
  reconnectNote: {
    margin: "0.15rem 0 0",
    fontSize: "0.75rem",
    color: "var(--muted)",
  },
  identity: {
    display: "flex",
    alignItems: "center",
    gap: "0.6rem",
    minWidth: 0,
  },
  platformIcon: {
    width: 30,
    height: 30,
    borderRadius: 8,
    color: "#ffffff",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "0.8125rem",
    fontWeight: 900,
    flexShrink: 0,
  },
  accountName: {
    margin: 0,
    fontWeight: 600,
    fontSize: "0.9375rem",
  },
  accountHandle: {
    margin: "0.1rem 0 0",
    fontSize: "0.8125rem",
    color: "var(--muted)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  metricBlock: {
    minWidth: 0,
  },
  metricValue: {
    margin: 0,
    fontSize: "1.5rem",
    fontWeight: 700,
    fontVariantNumeric: "tabular-nums",
    lineHeight: 1.2,
  },
  metricLabel: {
    margin: "0.1rem 0 0",
    fontSize: "0.75rem",
    color: "var(--muted)",
  },
  trendBlock: {
    minWidth: 0,
  },
  trendCaption: {
    margin: "0.3rem 0 0",
    fontSize: "0.6875rem",
    color: "var(--muted)",
  },
  metaBlock: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: "0.4rem",
    minWidth: 0,
  },
  statusChip: {
    display: "inline-block",
    padding: "0.2rem 0.5rem",
    borderRadius: 9999,
    fontSize: "0.75rem",
    fontWeight: 600,
  },
  lastUpdated: {
    margin: 0,
    fontSize: "0.75rem",
    color: "var(--muted)",
  },
  gatedNotice: {
    margin: 0,
    fontSize: "0.75rem",
    color: "var(--muted)",
    maxWidth: "42ch",
  },
  refreshForm: {
    marginTop: "0.15rem",
  },
  buttonPrimary: {
    minHeight: 44,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "0.55rem 0.9rem",
    backgroundColor: "var(--primary-fill)",
    color: "#ffffff",
    textDecoration: "none",
    border: "none",
    borderRadius: 8,
    fontWeight: 600,
    fontSize: "0.8125rem",
    cursor: "pointer",
  },
  buttonSecondary: {
    minHeight: 44,
    padding: "0.55rem 0.9rem",
    border: "1px solid var(--border)",
    borderRadius: 8,
    backgroundColor: "transparent",
    color: "var(--foreground)",
    fontWeight: 600,
    fontSize: "0.8125rem",
    cursor: "pointer",
  },
  buttonDisabled: {
    minHeight: 44,
    padding: "0.55rem 0.9rem",
    border: "1px solid var(--border)",
    borderRadius: 8,
    backgroundColor: "transparent",
    color: "var(--muted)",
    fontWeight: 500,
    fontSize: "0.8125rem",
    cursor: "not-allowed",
  },
  emptyState: {
    border: "1px dashed var(--border)",
    borderRadius: 12,
    padding: "2.25rem 1rem",
    textAlign: "center",
    marginTop: "0.85rem",
  },
  emptyText: {
    margin: 0,
    fontSize: "0.875rem",
    color: "var(--muted)",
  },
  connectGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
    gap: "0.875rem",
    marginTop: "0.85rem",
  },
  connectCard: {
    border: "1px solid var(--border)",
    borderRadius: 12,
    padding: "1rem",
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    backgroundColor: "var(--card)",
  },
  cardHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "0.5rem",
  },
  platformBadgeWrap: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
  },
  platformName: {
    fontSize: "0.9375rem",
    fontWeight: 600,
  },
  connectedBadge: {
    fontSize: "0.7rem",
    fontWeight: 600,
    padding: "0.15rem 0.45rem",
    borderRadius: 9999,
    backgroundColor: "var(--success-soft)",
    color: "var(--success)",
  },
  connectBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
    padding: "0.55rem 0.75rem",
    backgroundColor: "var(--primary-fill)",
    color: "#ffffff",
    textDecoration: "none",
    borderRadius: 8,
    fontWeight: 600,
    fontSize: "0.8125rem",
  },
  reconnectBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
    padding: "0.55rem 0.75rem",
    border: "1px solid var(--border)",
    borderRadius: 8,
    backgroundColor: "transparent",
    color: "var(--foreground)",
    textDecoration: "none",
    fontWeight: 600,
    fontSize: "0.8125rem",
  },
  bannerSuccess: {
    backgroundColor: "var(--success-soft)",
    color: "var(--success)",
    border: "1px solid var(--success)",
    borderRadius: 10,
    padding: "0.75rem 1rem",
    marginBottom: "1.25rem",
    display: "flex",
    alignItems: "center",
    gap: "0.6rem",
    fontSize: "0.8125rem",
  },
  bannerWarning: {
    backgroundColor: "var(--warning-soft)",
    color: "var(--warning)",
    border: "1px solid var(--warning)",
    borderRadius: 10,
    padding: "0.75rem 1rem",
    marginBottom: "1.25rem",
    display: "flex",
    alignItems: "center",
    gap: "0.6rem",
    fontSize: "0.8125rem",
  },
  bannerError: {
    backgroundColor: "var(--danger-soft)",
    color: "var(--danger)",
    border: "1px solid var(--danger)",
    borderRadius: 10,
    padding: "0.75rem 1rem",
    marginBottom: "1.25rem",
    display: "flex",
    alignItems: "center",
    gap: "0.6rem",
    fontSize: "0.8125rem",
  },
  bannerIcon: {
    fontSize: "1rem",
    fontWeight: "bold",
  },
} satisfies Record<string, CSSProperties>;
