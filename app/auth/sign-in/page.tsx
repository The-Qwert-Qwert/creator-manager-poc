"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  POST_AUTH_REDIRECT_COOKIE,
  POST_AUTH_REDIRECT_MAX_AGE_SECONDS,
  safeRedirectPath,
} from "@/lib/auth/redirect";
import { createClient } from "@/lib/supabase/client";

function messageForAuthError(code: string | null): string | null {
  switch (code) {
    case "link_expired":
      return "That sign-in link has expired or has already been used. Send yourself a new one below.";
    case "exchange_failed":
      return "We couldn't complete that sign-in. Send yourself a new link below.";
    case "missing_code":
      return "That sign-in link was incomplete. Send yourself a new one below.";
    case null:
      return null;
    default:
      return "We couldn't complete sign-in. Please try again.";
  }
}

export default function SignInPage() {
  return (
    <Suspense fallback={<div style={styles.pageWrap} />}>
      <SignInForm />
    </Suspense>
  );
}

function SignInForm() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const displayedError = error ?? messageForAuthError(searchParams.get("error"));
  const supabase = createClient();
  const redirectParam = searchParams.get("redirect");

  /**
   * The destination travels through Supabase in a cookie, so it has to be in
   * place before the auth call leaves the browser. With no destination in the
   * URL, clear any stale one rather than let it hijack this sign-in.
   */
  function rememberDestination() {
    if (!redirectParam) {
      document.cookie = `${POST_AUTH_REDIRECT_COOKIE}=; path=/; max-age=0`;
      return;
    }

    const destination = encodeURIComponent(safeRedirectPath(redirectParam));
    document.cookie = `${POST_AUTH_REDIRECT_COOKIE}=${destination}; path=/; max-age=${POST_AUTH_REDIRECT_MAX_AGE_SECONDS}; samesite=lax`;
  }

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;
    setError(null);
    rememberDestination();
    setLoading(true);

    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${location.origin}/auth/callback` },
      });
      if (error) {
        setError(error.message);
      } else {
        setSent(true);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to send magic link",
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    setError(null);
    rememberDestination();
    setGoogleLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${location.origin}/auth/callback` },
      });
      if (error) {
        setError(error.message);
        setGoogleLoading(false);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to sign in with Google",
      );
      setGoogleLoading(false);
    }
  }

  return (
    <div style={styles.pageWrap}>
      <main style={styles.card}>
        {/* Brand / Logo */}
        <div style={styles.brandHeader}>
          <h1 style={styles.title}>Creator Analytics</h1>
          <p style={styles.subtitle}>
            Connect and monitor your cross-platform creator metrics
          </p>
        </div>

        {sent ? (
          <div style={styles.sentContainer} role="status">
            <div style={styles.sentIconWrap}>
              <span style={styles.sentIcon}>✉️</span>
            </div>
            <h2 style={styles.sentTitle}>Check your inbox</h2>
            <p style={styles.sentDesc}>We sent a magic sign-in link to:</p>
            <p style={styles.sentEmail}>{email}</p>
            <p style={styles.sentHint}>
              Click the link in your email to sign in instantly.
            </p>
            <button
              type="button"
              onClick={() => {
                setSent(false);
                setEmail("");
              }}
              style={styles.backBtn}
            >
              ← Use a different email
            </button>
          </div>
        ) : (
          <>
            {displayedError && (
              <div style={styles.errorBanner} role="alert">
                <span style={styles.errorIcon}>✕</span>
                <span style={styles.errorText}>{displayedError}</span>
              </div>
            )}

            {/* Google OAuth Button */}
            <button
              type="button"
              onClick={handleGoogle}
              disabled={googleLoading || loading}
              style={{
                ...styles.googleBtn,
                opacity: googleLoading ? 0.7 : 1,
                cursor: googleLoading ? "not-allowed" : "pointer",
              }}
              aria-label="Continue with Google"
            >
              <svg
                style={styles.googleIcon}
                viewBox="0 0 24 24"
                width="18"
                height="18"
              >
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                />
              </svg>
              <span>
                {googleLoading
                  ? "Connecting to Google..."
                  : "Continue with Google"}
              </span>
            </button>

            {/* Divider */}
            <div style={styles.dividerWrap}>
              <div style={styles.dividerLine} />
              <span style={styles.dividerText}>or sign in with email</span>
              <div style={styles.dividerLine} />
            </div>

            {/* Email Form */}
            <form onSubmit={handleMagicLink} style={styles.form}>
              <div style={styles.inputGroup}>
                <label htmlFor="email-input" style={styles.label}>
                  Email address
                </label>
                <input
                  id="email-input"
                  type="email"
                  required
                  placeholder="name@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={loading || googleLoading}
                  style={styles.input}
                  autoComplete="email"
                />
              </div>

              <button
                type="submit"
                disabled={loading || googleLoading}
                style={{
                  ...styles.submitBtn,
                  opacity: loading ? 0.7 : 1,
                  cursor: loading ? "not-allowed" : "pointer",
                }}
              >
                {loading ? "Sending magic link..." : "Send magic link"}
              </button>
            </form>
          </>
        )}

        {/* Footer info */}
        <div style={styles.footer}>
          <span style={styles.versionBadge}>PoC v0.1.0</span>
          <span style={styles.footerText}>
            Secure authentication via Supabase
          </span>
        </div>
      </main>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  pageWrap: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "2rem 1rem",
    backgroundColor: "var(--background)",
  },
  card: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: "var(--card)",
    color: "var(--card-foreground)",
    border: "1px solid var(--border)",
    borderRadius: 16,
    padding: "2.25rem 2rem",
    boxShadow:
      "0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -2px rgba(0, 0, 0, 0.05)",
  },
  brandHeader: {
    textAlign: "center",
    marginBottom: "2rem",
  },
  logoBadge: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: "rgba(37, 99, 235, 0.1)",
    marginBottom: "1rem",
  },
  logoIcon: {
    fontSize: "1.5rem",
  },
  title: {
    margin: "0 0 0.5rem 0",
    fontSize: "1.5rem",
    fontWeight: 700,
    letterSpacing: "-0.025em",
    color: "var(--foreground)",
  },
  subtitle: {
    margin: 0,
    fontSize: "0.875rem",
    color: "var(--muted)",
    lineHeight: 1.4,
  },
  googleBtn: {
    width: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "0.75rem",
    padding: "0.75rem 1rem",
    borderRadius: 10,
    border: "1px solid var(--border)",
    backgroundColor: "var(--card)",
    color: "var(--foreground)",
    fontSize: "0.9375rem",
    fontWeight: 600,
    transition: "background-color 0.15s ease, border-color 0.15s ease",
  },
  googleIcon: {
    flexShrink: 0,
  },
  dividerWrap: {
    display: "flex",
    alignItems: "center",
    margin: "1.5rem 0",
    gap: "0.75rem",
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: "var(--border)",
  },
  dividerText: {
    fontSize: "0.75rem",
    color: "var(--muted)",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    fontWeight: 500,
  },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: "1.25rem",
  },
  inputGroup: {
    display: "flex",
    flexDirection: "column",
    gap: "0.5rem",
  },
  label: {
    fontSize: "0.8125rem",
    fontWeight: 600,
    color: "var(--foreground)",
  },
  input: {
    padding: "0.75rem 1rem",
    fontSize: "0.9375rem",
    borderRadius: 10,
    border: "1px solid var(--border)",
    backgroundColor: "var(--background)",
    color: "var(--foreground)",
    outline: "none",
    boxSizing: "border-box",
    transition: "border-color 0.15s ease",
  },
  submitBtn: {
    padding: "0.75rem 1rem",
    fontSize: "0.9375rem",
    fontWeight: 600,
    borderRadius: 10,
    border: "none",
    backgroundColor: "var(--primary)",
    color: "#ffffff",
    transition: "background-color 0.15s ease",
  },
  errorBanner: {
    backgroundColor: "rgba(239, 68, 68, 0.1)",
    color: "#b91c1c",
    border: "1px solid rgba(239, 68, 68, 0.25)",
    borderRadius: 10,
    padding: "0.75rem 1rem",
    marginBottom: "1.25rem",
    display: "flex",
    alignItems: "center",
    gap: "0.6rem",
    fontSize: "0.8125rem",
  },
  errorIcon: {
    fontSize: "0.875rem",
    fontWeight: "bold",
    flexShrink: 0,
  },
  errorText: {
    lineHeight: 1.4,
  },
  sentContainer: {
    textAlign: "center",
    padding: "1rem 0",
  },
  sentIconWrap: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: "rgba(16, 185, 129, 0.1)",
    marginBottom: "1rem",
  },
  sentIcon: {
    fontSize: "1.75rem",
  },
  sentTitle: {
    margin: "0 0 0.5rem 0",
    fontSize: "1.25rem",
    fontWeight: 700,
    color: "var(--foreground)",
  },
  sentDesc: {
    margin: "0 0 0.25rem 0",
    fontSize: "0.875rem",
    color: "var(--muted)",
  },
  sentEmail: {
    margin: "0 0 1rem 0",
    fontSize: "0.9375rem",
    fontWeight: 600,
    color: "var(--foreground)",
  },
  sentHint: {
    margin: "0 0 1.5rem 0",
    fontSize: "0.8125rem",
    color: "var(--muted)",
    lineHeight: 1.4,
  },
  backBtn: {
    background: "none",
    border: "none",
    color: "var(--primary)",
    fontSize: "0.875rem",
    fontWeight: 600,
    cursor: "pointer",
    padding: "0.5rem",
  },
  footer: {
    marginTop: "2rem",
    paddingTop: "1.25rem",
    borderTop: "1px solid var(--border)",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    fontSize: "0.75rem",
  },
  versionBadge: {
    fontSize: "0.6875rem",
    fontWeight: 600,
    padding: "0.2rem 0.5rem",
    borderRadius: 6,
    backgroundColor: "var(--muted-background)",
    color: "var(--muted)",
  },
  footerText: {
    color: "var(--muted)",
  },
};
