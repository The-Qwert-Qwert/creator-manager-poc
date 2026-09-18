// The single place that decides whether a post-auth destination is same-origin.
export const DEFAULT_SIGNED_IN_PATH = "/dashboard";

/**
 * Whoever bounces a user to sign-in records where they were headed here, so the
 * destination survives the Supabase round trip without riding on the OAuth
 * redirect URL.
 */
export const POST_AUTH_REDIRECT_COOKIE = "post_auth_redirect";
// Outlives the slowest sign-in path — a magic link left sitting in an inbox —
// so the destination is still there when the link is finally opened.
export const POST_AUTH_REDIRECT_MAX_AGE_SECONDS = 3600;

export function safeRedirectPath(
  value: string | null | undefined,
  fallback: string = DEFAULT_SIGNED_IN_PATH,
): string {
  if (value === null || value === undefined) return fallback;
  if (!value.startsWith("/")) return fallback;
  if (value.startsWith("//")) return fallback;
  if (value.includes("\\")) return fallback;
  for (const char of value) {
    const code = char.codePointAt(0);
    if (code === undefined || code < 0x20 || code === 0x7f) return fallback;
  }
  return value;
}
