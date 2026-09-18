import { redirect } from "next/navigation";
import { config } from "@/lib/config";
import { createClient } from "@/lib/supabase/server";
import { PLATFORMS, type Platform } from "@/lib/adapters/types";

interface DashboardPageProps {
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
}

const PLATFORM_NAMES: Record<Platform, string> = {
  youtube: "YouTube",
  tiktok: "TikTok",
  instagram: "Instagram",
  facebook: "Facebook",
};

export default async function DashboardPage(props: DashboardPageProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/sign-in");

  const searchParams = props.searchParams ? await props.searchParams : {};
  const connectedPlatform = typeof searchParams.connected === "string" ? searchParams.connected : undefined;
  const deniedPlatform = typeof searchParams.denied === "string" ? searchParams.denied : undefined;
  const errorParam = typeof searchParams.error === "string" ? searchParams.error : undefined;

  // Fetch connected accounts with snapshots
  const { data: rawAccounts } = await supabase
    .from("connected_accounts")
    .select(`
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
    `)
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

  // Filter accounts behind feature flag (Requirement 6: flag-gated until Meta approval)
  const accounts = (rawAccounts || []).filter((account) => {
    if (!config.features.enableMeta && (account.platform === "instagram" || account.platform === "facebook")) {
      return false;
    }
    return true;
  });

  const connectedMap = new Map<Platform, typeof accounts[0]>();
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
    <main style={styles.main}>
      <header style={styles.header}>
        <div>
          <h1 style={styles.title}>Creator Analytics</h1>
          <p style={styles.subtitle}>Signed in as {user.email}</p>
        </div>
        <form action={signOut}>
          <button type="submit" style={styles.secondaryBtn}>Sign out</button>
        </form>
      </header>

      {/* Notifications / Feedback */}
      {connectedPlatform && (
        <div style={styles.bannerSuccess} role="status">
          <strong>Connected!</strong> Successfully connected your {PLATFORM_NAMES[connectedPlatform as Platform] || connectedPlatform} account.
        </div>
      )}

      {deniedPlatform && (
        <div style={styles.bannerWarning} role="alert">
          <strong>Connection cancelled:</strong> Access was denied or cancelled for {PLATFORM_NAMES[deniedPlatform as Platform] || deniedPlatform}.
        </div>
      )}

      {errorParam && (
        <div style={styles.bannerError} role="alert">
          <strong>Connection error:</strong> {formatErrorMessage(errorParam)}. Please try again.
        </div>
      )}

      {/* Connect Platform Buttons (Requirement 1 & 2) */}
      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>Connect Platforms</h2>
        <p style={styles.sectionDesc}>Connect your social accounts to monitor all your creator metrics in one place.</p>
        <div style={styles.connectGrid}>
          {PLATFORMS.map((platform) => {
            const connectedAccount = connectedMap.get(platform);
            const isConnected = Boolean(connectedAccount);
            const isMeta = platform === "instagram" || platform === "facebook";

            return (
              <div key={platform} style={styles.connectCard}>
                <div style={styles.cardHeader}>
                  <strong style={styles.platformName}>{PLATFORM_NAMES[platform]}</strong>
                  {isMeta && !config.features.enableMeta && (
                    <span style={styles.flagBadge}>Meta Approval Pending</span>
                  )}
                  {isConnected && (
                    <span style={styles.connectedBadge}>Active</span>
                  )}
                </div>
                {isConnected ? (
                  <div style={styles.connectedDetails}>
                    <span style={styles.accountHandle}>@{connectedAccount?.handle}</span>
                    <a
                      href={`/api/auth/${platform}`}
                      style={styles.reconnectBtn}
                      aria-label={`Reconnect ${PLATFORM_NAMES[platform]}`}
                    >
                      Reconnect
                    </a>
                  </div>
                ) : (
                  <a
                    href={`/api/auth/${platform}`}
                    style={styles.connectBtn}
                    aria-label={`Connect ${PLATFORM_NAMES[platform]}`}
                  >
                    Connect {PLATFORM_NAMES[platform]}
                  </a>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Connected Platform Rows (Requirement 3, 4, 6) */}
      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>Connected Accounts</h2>
        {accounts.length === 0 ? (
          <div style={styles.emptyState}>
            <p>No platforms connected yet. Click any button above to connect your first account.</p>
          </div>
        ) : (
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
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
                  const snapshots = acc.metric_snapshots || [];
                  const latestSnapshot = [...snapshots].sort(
                    (a, b) => new Date(b.captured_on).getTime() - new Date(a.captured_on).getTime()
                  )[0];
                  const audience = latestSnapshot ? latestSnapshot.audience_count.toLocaleString() : "—";
                  const lastSynced = acc.last_synced_at
                    ? new Date(acc.last_synced_at).toLocaleString()
                    : "Just now";

                  return (
                    <tr key={acc.id} style={styles.tr}>
                      <td style={styles.td}>
                        <span style={styles.platformPill}>
                          {PLATFORM_NAMES[acc.platform as Platform] || acc.platform}
                        </span>
                      </td>
                      <td style={styles.td}>
                        <div style={styles.userCell}>
                          {acc.avatar_url && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={acc.avatar_url}
                              alt=""
                              style={styles.avatar}
                            />
                          )}
                          <span style={styles.boldHandle}>@{acc.handle}</span>
                        </div>
                      </td>
                      <td style={styles.td}>{audience}</td>
                      <td style={styles.td}>
                        <span style={styles.statusActive}>{acc.status}</span>
                      </td>
                      <td style={styles.td}>{lastSynced}</td>
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
  );
}

function formatErrorMessage(code: string): string {
  switch (code) {
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
  main: {
    fontFamily: "system-ui, -apple-system, sans-serif",
    maxWidth: 960,
    margin: "0 auto",
    padding: "2rem 1.5rem",
    color: "#111827",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "2rem",
    borderBottom: "1px solid #e5e7eb",
    paddingBottom: "1.5rem",
  },
  title: {
    margin: "0 0 0.25rem",
    fontSize: "1.75rem",
    fontWeight: 700,
  },
  subtitle: {
    margin: 0,
    color: "#6b7280",
    fontSize: "0.95rem",
  },
  section: {
    marginBottom: "2.5rem",
  },
  sectionTitle: {
    fontSize: "1.25rem",
    margin: "0 0 0.5rem",
    fontWeight: 600,
  },
  sectionDesc: {
    margin: "0 0 1.25rem",
    color: "#4b5563",
    fontSize: "0.95rem",
  },
  connectGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
    gap: "1rem",
  },
  connectCard: {
    border: "1px solid #e5e7eb",
    borderRadius: 8,
    padding: "1.25rem",
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    backgroundColor: "#ffffff",
    boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
  },
  cardHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "1rem",
    flexWrap: "wrap",
    gap: "0.5rem",
  },
  platformName: {
    fontSize: "1.05rem",
  },
  connectedBadge: {
    fontSize: "0.75rem",
    fontWeight: 600,
    padding: "0.2rem 0.5rem",
    borderRadius: 9999,
    backgroundColor: "#d1fae5",
    color: "#065f46",
  },
  flagBadge: {
    fontSize: "0.7rem",
    padding: "0.15rem 0.4rem",
    borderRadius: 4,
    backgroundColor: "#fef3c7",
    color: "#92400e",
  },
  connectedDetails: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: "0.5rem",
  },
  accountHandle: {
    fontSize: "0.9rem",
    color: "#374151",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    maxWidth: "110px",
  },
  connectBtn: {
    display: "inline-block",
    textAlign: "center",
    padding: "0.6rem 1rem",
    backgroundColor: "#2563eb",
    color: "#ffffff",
    textDecoration: "none",
    borderRadius: 6,
    fontWeight: 500,
    fontSize: "0.9rem",
  },
  reconnectBtn: {
    fontSize: "0.85rem",
    color: "#2563eb",
    textDecoration: "none",
    fontWeight: 500,
    padding: "0.3rem 0.6rem",
    border: "1px solid #bfdbfe",
    borderRadius: 4,
    backgroundColor: "#eff6ff",
  },
  secondaryBtn: {
    padding: "0.5rem 1rem",
    border: "1px solid #d1d5db",
    borderRadius: 6,
    backgroundColor: "#ffffff",
    cursor: "pointer",
    fontSize: "0.9rem",
    color: "#374151",
  },
  bannerSuccess: {
    backgroundColor: "#ecfdf5",
    color: "#065f46",
    border: "1px solid #a7f3d0",
    borderRadius: 6,
    padding: "0.75rem 1rem",
    marginBottom: "1.5rem",
  },
  bannerWarning: {
    backgroundColor: "#fffbeb",
    color: "#92400e",
    border: "1px solid #fde68a",
    borderRadius: 6,
    padding: "0.75rem 1rem",
    marginBottom: "1.5rem",
  },
  bannerError: {
    backgroundColor: "#fef2f2",
    color: "#991b1b",
    border: "1px solid #fecaca",
    borderRadius: 6,
    padding: "0.75rem 1rem",
    marginBottom: "1.5rem",
  },
  emptyState: {
    border: "1px dashed #d1d5db",
    borderRadius: 8,
    padding: "2rem",
    textAlign: "center",
    color: "#6b7280",
  },
  tableWrap: {
    overflowX: "auto",
    border: "1px solid #e5e7eb",
    borderRadius: 8,
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    textAlign: "left",
    fontSize: "0.9rem",
  },
  th: {
    padding: "0.75rem 1rem",
    backgroundColor: "#f9fafb",
    borderBottom: "1px solid #e5e7eb",
    color: "#374151",
    fontWeight: 600,
  },
  td: {
    padding: "0.75rem 1rem",
    borderBottom: "1px solid #e5e7eb",
    verticalAlign: "middle",
  },
  tr: {
    backgroundColor: "#ffffff",
  },
  platformPill: {
    display: "inline-block",
    padding: "0.2rem 0.6rem",
    borderRadius: 4,
    backgroundColor: "#f3f4f6",
    fontWeight: 500,
    fontSize: "0.85rem",
  },
  userCell: {
    display: "flex",
    alignItems: "center",
    gap: "0.6rem",
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: "50%",
    objectFit: "cover",
  },
  boldHandle: {
    fontWeight: 500,
  },
  statusActive: {
    display: "inline-block",
    padding: "0.15rem 0.5rem",
    borderRadius: 9999,
    fontSize: "0.8rem",
    fontWeight: 500,
    backgroundColor: "#d1fae5",
    color: "#065f46",
  },
  tableActionLink: {
    color: "#2563eb",
    textDecoration: "none",
    fontWeight: 500,
  },
};
