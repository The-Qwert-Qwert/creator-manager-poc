"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getAdapter, registerDefaultAdapters } from "@/lib/adapters/registry";
import { AdapterError, type AdapterErrorCode, type Platform } from "@/lib/adapters/types";
import { requireUser } from "@/lib/auth/session";
import { cooldownRemainingMs } from "@/lib/dashboard/manual-refresh";
import { decryptToken } from "@/lib/token-crypto";

const REFRESHABLE_COLUMNS =
  "id, platform, external_id, handle, access_token_enc, last_manual_refresh_at";

function decodeBytea(value: string): Buffer {
  return Buffer.from(value.startsWith("\\x") ? value.slice(2) : value, "hex");
}

function dashboardPath(params: Record<string, string>): string {
  return `/dashboard?${new URLSearchParams(params).toString()}`;
}

function failureParam(code: AdapterErrorCode | undefined): string {
  switch (code) {
    case "REVOKED":
    case "UNAUTHORIZED":
      return "expired";
    case "RATE_LIMITED":
      return "rate_limited";
    case "NOT_FOUND":
      return "not_found";
    default:
      return "failed";
  }
}

/**
 * FR-6: user-initiated refresh of a single account. Only ever runs on a form
 * submission — the dashboard render itself never calls a platform API.
 */
export async function refreshAccount(formData: FormData): Promise<void> {
  const accountId = formData.get("accountId");

  if (typeof accountId !== "string" || accountId.length === 0) {
    redirect(dashboardPath({ refresh: "failed" }));
  }

  const { supabase } = await requireUser();

  const { data: account } = await supabase
    .from("connected_accounts")
    .select(REFRESHABLE_COLUMNS)
    .eq("id", accountId)
    .maybeSingle();

  if (!account) {
    redirect(dashboardPath({ refresh: "failed" }));
  }

  if (cooldownRemainingMs(account.last_manual_refresh_at) > 0) {
    redirect(dashboardPath({ refresh: "cooldown", platform: account.platform }));
  }

  // Claim the cooldown slot before calling the platform, so a failing account
  // cannot be clicked into a retry storm (FSD §10 rate-limit hygiene).
  const attemptedAt = new Date().toISOString();
  await supabase
    .from("connected_accounts")
    .update({ last_manual_refresh_at: attemptedAt })
    .eq("id", account.id);

  registerDefaultAdapters();
  const adapter = getAdapter(account.platform as Platform);

  try {
    const profile = await adapter.fetchProfile({
      id: account.id,
      platform: account.platform as Platform,
      externalId: account.external_id,
      tokens: { accessToken: decryptToken(decodeBytea(account.access_token_enc)) },
    });

    await supabase.from("metric_snapshots").upsert(
      {
        connected_account_id: account.id,
        captured_on: attemptedAt.slice(0, 10),
        audience_count: profile.audienceCount,
        extras: profile.extras,
      },
      { onConflict: "connected_account_id,captured_on" },
    );

    await supabase
      .from("connected_accounts")
      .update({
        handle: profile.handle,
        avatar_url: profile.avatarUrl ?? null,
        status: "active",
        last_synced_at: attemptedAt,
      })
      .eq("id", account.id);
  } catch (error) {
    const code = error instanceof AdapterError ? error.code : undefined;

    // FR-5: stop retrying a dead token until the user reconnects.
    if (code === "REVOKED" || code === "UNAUTHORIZED") {
      await supabase
        .from("connected_accounts")
        .update({ status: "needs_reconnect" })
        .eq("id", account.id);
    }

    revalidatePath("/dashboard");
    redirect(dashboardPath({ refresh: failureParam(code), platform: account.platform }));
  }

  revalidatePath("/dashboard");
  redirect(dashboardPath({ refreshed: account.platform }));
}
