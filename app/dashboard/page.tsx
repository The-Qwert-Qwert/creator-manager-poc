import { redirect } from "next/navigation";
import { config } from "@/lib/config";
import { createClient } from "@/lib/supabase/server";
import { PLATFORMS, type Platform } from "@/lib/adapters/types";
import { requireUser } from "@/lib/auth/session";

interface DashboardPageProps {
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
}

interface PlatformMeta {
  name: string;
  icon: string;
  iconBg: string;
}

const PLATFORM_INFO: Record<Platform, PlatformMeta> = {
  youtube: {
    name: "YouTube",
    icon: "▶",
    iconBg: "#dc2626",
  },
  tiktok: {
    name: "TikTok",
    icon: "♪",
    iconBg: "#000000",
  },
  instagram: {
    name: "Instagram",
    icon: "IG",
    iconBg: "linear-gradient(45deg, #f59e0b, #e11d48, #7c3aed)",
  },
  facebook: {
    name: "Facebook",
    icon: "f",
    iconBg: "#2563eb",
  },
};

export default async function DashboardPage(props: DashboardPageProps) {
  const { user, supabase } = await requireUser();

  const searchParams = props.searchParams ? await props.searchParams : {};
  const connectedPlatform =
    typeof searchParams.connected === "string"
      ? searchParams.connected
      : undefined;
  const deniedPlatform =
    typeof searchParams.denied === "string" ? searchParams.denied : undefined;
  const errorParam =
    typeof searchParams.error === "string" ? searchParams.error : undefined;

  // Fetch connected accounts with snapshots
  const { data: rawAccounts } = await supabase
    .from("connected_accounts")
    .select(
      `
      id,
      platform,
      external_id,
      handle,
      avatar_url,
      status,
      last_synced_at,
      created_at,
      metric_snapshots (
        audience_count,
        captured_on
      )
    `,
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

  // Filter accounts behind feature flag (Requirement 6: flag-gated until Meta approval)
  const accounts = (rawAccounts || []).filter((account) => {
    if (
      !config.features.enableMeta &&
      (account.platform === "instagram" || account.platform === "facebook")
    ) {
      return false;
    }
    return true;
  });

  // Filter connectable platforms behind feature flag
  const connectablePlatforms = PLATFORMS.filter((platform) => {
    if (
      !config.features.enableMeta &&
      (platform === "instagram" || platform === "facebook")
    ) {
      return false;
    }
    return true;
  });

  const connectedMap = new Map<Platform, (typeof accounts)[0]>();
  for (const acc of accounts) {
    connectedMap.set(acc.platform as Platform, acc);
  }

  async function signOut() {
    "use server";
    const supabaseClient = await createClient();
    await supabaseClient.auth.signOut();
    redirect("/auth/sign-in");
  }

  return (
    <div style={styles.pageWrap}>
      <main style={styles.dashboardCard}>
        {/* Header */}
        <header style={styles.header}>
          <div>
            <div style={styles.titleRow}>
              <h1 style={styles.title}>Creator Analytics</h1>
              <span style={styles.versionBadge}>PoC v0.1.0</span>
            </div>
            <p style={styles.subtitle}>
              Signed in as{" "}
              <strong style={{ color: "var(--foreground)" }}>
                {user.email}
              </strong>
            </p>
          </div>
          <form action={signOut}>
            <button type="submit" style={styles.signOutBtn}>
              Sign out
            </button>
          </form>
        </header>

        {/* Notifications / Feedback */}
        {connectedPlatform && (
          <div style={styles.bannerSuccess} role="status">
            <span style={styles.bannerIcon}>✓</span>
            <div>
              <strong>Connected!</strong> Successfully connected your{" "}
              <strong>
                {PLATFORM_INFO[connectedPlatform as Platform]?.name ||
                  connectedPlatform}
              </strong>{" "}
              account.
            </div>
          </div>
        )}

        {deniedPlatform && (
          <div style={styles.bannerWarning} role="alert">
            <span style={styles.bannerIcon}>⚠</span>
            <div>
              <strong>Connection cancelled:</strong> Access was denied or
              cancelled for{" "}
              <strong>
                {PLATFORM_INFO[deniedPlatform as Platform]?.name ||
                  deniedPlatform}
              </strong>
              .
            </div>
          </div>
        )}

        {errorParam && (
          <div style={styles.bannerError} role="alert">
            <span style={styles.bannerIcon}>✕</span>
            <div>
              <strong>Connection error:</strong>{" "}
              {formatErrorMessage(errorParam)}. Please try again.
            </div>
          </div>
        )}

        {/* Connect Platforms Section (Requirement 1 & 2) */}
        <section style={styles.section}>
          <div style={{ marginBottom: "1rem" }}>
            <h2 style={styles.sectionTitle}>Connect Platforms</h2>
            <p style={styles.sectionDesc}>
              Connect your social accounts to monitor all creator metrics in one
              place.
            </p>
          </div>

          <div style={styles.connectGrid}>
            {connectablePlatforms.map((platform) => {
              const meta = PLATFORM_INFO[platform];
              const connectedAccount = connectedMap.get(platform);
              const isConnected = Boolean(connectedAccount);

              return (
                <div key={platform} style={styles.connectCard}>
                  <div style={styles.cardHeader}>
                    <div style={styles.platformBadgeWrap}>
                      <span
                        style={{
                          ...styles.platformIcon,
                          background: meta.iconBg,
                        }}
                      >
                        {meta.icon}
                      </span>
                      <strong style={styles.platformName}>{meta.name}</strong>
                    </div>

                    {isConnected && (
                      <span style={styles.connectedBadge}>Active</span>
                    )}
                  </div>

                  <div style={{ marginTop: "auto", paddingTop: "0.75rem" }}>
                    {isConnected ? (
                      <div style={styles.connectedDetails}>
                        <span style={styles.accountHandle}>
                          @{connectedAccount?.handle}
                        </span>
                        <a
                          href={`/api/auth/${platform}`}
                          style={styles.reconnectBtn}
                          aria-label={`Reconnect ${meta.name}`}
                        >
                          Reconnect
                        </a>
                      </div>
                    ) : (
                      <a
                        href={`/api/auth/${platform}`}
                        style={styles.connectBtn}
                        aria-label={`Connect ${meta.name}`}
                      >
                        Connect {meta.name}
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Connected Platform Rows (Requirement 3, 4, 6) */}
        <section style={styles.section}>
          <div style={styles.tableHeaderRow}>
            <h2 style={styles.sectionTitle}>Connected Accounts</h2>
            <span style={styles.countBadge}>
              {accounts.length} {accounts.length === 1 ? "account" : "accounts"}
            </span>
          </div>

          {accounts.length === 0 ? (
            <div style={styles.emptyState}>
              <p
                style={{
                  margin: 0,
                  fontSize: "0.875rem",
                  color: "var(--muted)",
                }}
              >
                No platforms connected yet. Click any button above to connect
                your first account.
              </p>
            </div>
          ) : (
            <div style={styles.tableWrap}>
              <table style={styles.table}>
                <thead>
                  <tr style={styles.trHead}>
                    <th style={styles.th}>Platform</th>
                    <th style={styles.th}>Account</th>
                    <th style={styles.th}>Audience</th>
                    <th style={styles.th}>Status</th>
                    <th style={styles.th}>Last Synced</th>
                    <th style={styles.th}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((acc) => {
                    const meta = PLATFORM_INFO[acc.platform as Platform];
                    const snapshots = acc.metric_snapshots || [];
                    const latestSnapshot = [...snapshots].sort(
                      (a, b) =>
                        new Date(b.captured_on).getTime() -
                        new Date(a.captured_on).getTime(),
                    )[0];
                    const audience = latestSnapshot
                      ? latestSnapshot.audience_count.toLocaleString()
                      : "—";
                    const lastSynced = acc.last_synced_at
                      ? new Date(acc.last_synced_at).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "Just now";

                    return (
                      <tr key={acc.id} style={styles.tr}>
                        <td style={styles.td}>
                          <span style={styles.platformPill}>
                            <span
                              style={{
                                ...styles.platformCircle,
                                background: meta?.iconBg || "#333",
                              }}
                            >
                              {meta?.icon || ""}
                            </span>
                            {meta?.name || acc.platform}
                          </span>
                        </td>
                        <td style={styles.td}>
                          <div style={styles.userCell}>
                            {acc.avatar_url ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={acc.avatar_url}
                                alt=""
                                style={styles.avatar}
                              />
                            ) : (
                              <div style={styles.avatarFallback}>
                                {acc.handle.slice(0, 1).toUpperCase()}
                              </div>
                            )}
                            <span style={styles.boldHandle}>@{acc.handle}</span>
                          </div>
                        </td>
                        <td
                          style={{
                            ...styles.td,
                            fontFamily: "monospace",
                            fontWeight: 600,
                          }}
                        >
                          {audience}
                        </td>
                        <td style={styles.td}>
                          <span style={styles.statusActive}>
                            ● {acc.status}
                          </span>
                        </td>
                        <td
                          style={{
                            ...styles.td,
                            color: "var(--muted)",
                            fontSize: "0.8125rem",
                          }}
                        >
                          {lastSynced}
                        </td>
                        <td style={styles.td}>
                          <a
                            href={`/api/auth/${acc.platform}`}
                            style={styles.tableActionLink}
                          >
                            Reconnect
                          </a>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
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

const styles: Record<string, React.CSSProperties> = {
  pageWrap: {
    maxWidth: 960,
    margin: "0 auto",
    padding: "2.5rem 1rem",
  },
  dashboardCard: {
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
    color: "#2563eb",
  },
  subtitle: {
    margin: "0.35rem 0 0",
    color: "var(--muted)",
    fontSize: "0.875rem",
  },
  signOutBtn: {
    padding: "0.45rem 0.9rem",
    border: "1px solid var(--border)",
    borderRadius: 8,
    backgroundColor: "transparent",
    cursor: "pointer",
    fontSize: "0.8125rem",
    fontWeight: 500,
    color: "var(--foreground)",
    transition: "background-color 0.15s",
  },
  section: {
    marginBottom: "2rem",
  },
  sectionTitle: {
    fontSize: "1.125rem",
    margin: 0,
    fontWeight: 600,
  },
  sectionDesc: {
    margin: "0.25rem 0 0",
    color: "var(--muted)",
    fontSize: "0.8125rem",
  },
  connectGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
    gap: "0.875rem",
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
  platformIcon: {
    width: 26,
    height: 26,
    borderRadius: 6,
    color: "#ffffff",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "0.75rem",
    fontWeight: 900,
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
    backgroundColor: "rgba(16, 185, 129, 0.15)",
    color: "#059669",
  },
  flagBadgeWarning: {
    fontSize: "0.6875rem",
    padding: "0.15rem 0.4rem",
    borderRadius: 4,
    backgroundColor: "rgba(245, 158, 11, 0.15)",
    color: "#d97706",
    fontWeight: 500,
  },
  flagBadgeDev: {
    fontSize: "0.6875rem",
    padding: "0.15rem 0.4rem",
    borderRadius: 4,
    backgroundColor: "rgba(16, 185, 129, 0.15)",
    color: "#059669",
    fontWeight: 500,
  },
  connectedDetails: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  accountHandle: {
    fontSize: "0.8125rem",
    color: "var(--foreground)",
    fontWeight: 500,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    maxWidth: "100px",
  },
  connectBtn: {
    display: "block",
    textAlign: "center",
    padding: "0.55rem 0.75rem",
    backgroundColor: "var(--primary)",
    color: "#ffffff",
    textDecoration: "none",
    borderRadius: 8,
    fontWeight: 500,
    fontSize: "0.8125rem",
  },
  reconnectBtn: {
    fontSize: "0.75rem",
    color: "var(--primary)",
    textDecoration: "none",
    fontWeight: 600,
    padding: "0.3rem 0.55rem",
    border: "1px solid var(--border)",
    borderRadius: 6,
    backgroundColor: "rgba(37, 99, 235, 0.08)",
  },
  bannerSuccess: {
    backgroundColor: "rgba(16, 185, 129, 0.1)",
    color: "#047857",
    border: "1px solid rgba(16, 185, 129, 0.25)",
    borderRadius: 10,
    padding: "0.75rem 1rem",
    marginBottom: "1.5rem",
    display: "flex",
    alignItems: "center",
    gap: "0.6rem",
    fontSize: "0.8125rem",
  },
  bannerWarning: {
    backgroundColor: "rgba(245, 158, 11, 0.1)",
    color: "#b45309",
    border: "1px solid rgba(245, 158, 11, 0.25)",
    borderRadius: 10,
    padding: "0.75rem 1rem",
    marginBottom: "1.5rem",
    display: "flex",
    alignItems: "center",
    gap: "0.6rem",
    fontSize: "0.8125rem",
  },
  bannerError: {
    backgroundColor: "rgba(239, 68, 68, 0.1)",
    color: "#b91c1c",
    border: "1px solid rgba(239, 68, 68, 0.25)",
    borderRadius: 10,
    padding: "0.75rem 1rem",
    marginBottom: "1.5rem",
    display: "flex",
    alignItems: "center",
    gap: "0.6rem",
    fontSize: "0.8125rem",
  },
  bannerIcon: {
    fontSize: "1rem",
    fontWeight: "bold",
  },
  tableHeaderRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: "0.75rem",
  },
  countBadge: {
    fontSize: "0.75rem",
    color: "var(--muted)",
  },
  emptyState: {
    border: "1px dashed var(--border)",
    borderRadius: 12,
    padding: "2.5rem 1rem",
    textAlign: "center",
  },
  tableWrap: {
    overflowX: "auto",
    border: "1px solid var(--border)",
    borderRadius: 12,
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    textAlign: "left",
    fontSize: "0.8125rem",
  },
  trHead: {
    backgroundColor: "var(--muted-background)",
    borderBottom: "1px solid var(--border)",
  },
  th: {
    padding: "0.65rem 1rem",
    color: "var(--muted)",
    fontWeight: 600,
    fontSize: "0.75rem",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  td: {
    padding: "0.75rem 1rem",
    borderBottom: "1px solid var(--border)",
    verticalAlign: "middle",
  },
  tr: {
    backgroundColor: "transparent",
  },
  platformPill: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.45rem",
    fontWeight: 500,
  },
  platformCircle: {
    width: 20,
    height: 20,
    borderRadius: "50%",
    color: "#ffffff",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "0.625rem",
    fontWeight: 900,
  },
  userCell: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
  },
  avatar: {
    width: 24,
    height: 24,
    borderRadius: "50%",
    objectFit: "cover",
    border: "1px solid var(--border)",
  },
  avatarFallback: {
    width: 24,
    height: 24,
    borderRadius: "50%",
    backgroundColor: "var(--muted-background)",
    border: "1px solid var(--border)",
    color: "var(--muted)",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "0.7rem",
    fontWeight: 600,
  },
  boldHandle: {
    fontWeight: 600,
  },
  statusActive: {
    display: "inline-block",
    padding: "0.15rem 0.45rem",
    borderRadius: 9999,
    fontSize: "0.75rem",
    fontWeight: 600,
    backgroundColor: "rgba(16, 185, 129, 0.15)",
    color: "#059669",
  },
  tableActionLink: {
    color: "var(--primary)",
    textDecoration: "none",
    fontWeight: 600,
  },
};
