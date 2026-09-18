import { createClient } from "@supabase/supabase-js";

import { config } from "@/lib/config";

/**
 * Service-role client for background jobs. Every RLS policy keys off auth.uid()
 * and a batch run has no session, so it has to bypass RLS. Server-side only —
 * the secret key carries no NEXT_PUBLIC_ prefix and cannot reach the browser.
 */
export function createAdminClient() {
  return createClient(config.supabase.url, config.supabase.secretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
