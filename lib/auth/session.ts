import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { User } from "@supabase/supabase-js";

export type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export interface RequireUserOptions {
  /**
   * Relative path or URL to redirect back to after sign-in.
   * e.g., "/dashboard" or "/settings"
   */
  redirectTo?: string;
  /**
   * Custom Supabase client instance (defaults to `await createClient()`).
   */
  client?: SupabaseServerClient;
}

export interface RequireUserResult {
  user: User;
  supabase: SupabaseServerClient;
}

/**
 * Ensures the request is authenticated by a valid Supabase user session.
 * If authenticated, returns the non-null `user` and the `supabase` server client.
 * If unauthenticated, triggers a Next.js `redirect()` to `/auth/sign-in` (with optional `redirect` param).
 *
 * Usage in Server Components / Pages:
 * ```ts
 * const { user, supabase } = await requireUser();
 * ```
 */
export async function requireUser(options: RequireUserOptions = {}): Promise<RequireUserResult> {
  const supabase = options.client ?? (await createClient());
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    const dest = options.redirectTo
      ? `/auth/sign-in?redirect=${encodeURIComponent(options.redirectTo)}`
      : "/auth/sign-in";
    redirect(dest);
  }

  return { user, supabase };
}

/**
 * Retrieves the current authenticated user without redirecting.
 * Returns `{ user, supabase }` where `user` is `User | null`.
 */
export async function getCurrentUser(client?: SupabaseServerClient): Promise<{
  user: User | null;
  supabase: SupabaseServerClient;
}> {
  const supabase = client ?? (await createClient());
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { user: user ?? null, supabase };
}
