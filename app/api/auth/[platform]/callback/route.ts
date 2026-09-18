import { NextResponse, type NextRequest } from "next/server";
import { PLATFORMS, type Platform } from "@/lib/adapters/types";
import { getAdapter, registerDefaultAdapters } from "@/lib/adapters/registry";
import { verifyState } from "@/lib/auth/state";
import { config } from "@/lib/config";
import { encodeBytea } from "@/lib/supabase/bytea";
import { createClient } from "@/lib/supabase/server";
import { encryptToken } from "@/lib/token-crypto";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ platform: string }> }
) {
  const { platform } = await context.params;

  if (!PLATFORMS.includes(platform as Platform)) {
    return NextResponse.json({ error: `Unknown platform: ${platform}` }, { status: 404 });
  }

  const isMeta = platform === "instagram" || platform === "facebook";
  if (isMeta && !config.features.enableMeta) {
    return NextResponse.json({ error: `Platform is currently disabled: ${platform}` }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);

  // 1. Graceful denial / error handling (FSD §5 FR-2, CREAT-23 Requirement 5)
  const errorParam = searchParams.get("error") || searchParams.get("error_code");
  if (errorParam) {
    const dashboardUrl = new URL("/dashboard", request.url);
    dashboardUrl.searchParams.set("denied", platform);
    return NextResponse.redirect(dashboardUrl);
  }

  const code = searchParams.get("code");
  const state = searchParams.get("state");

  if (!code || !state) {
    const dashboardUrl = new URL("/dashboard", request.url);
    dashboardUrl.searchParams.set("error", "missing_code_or_state");
    dashboardUrl.searchParams.set("platform", platform);
    return NextResponse.redirect(dashboardUrl);
  }

  // 2. CSRF state verification
  try {
    const verified = verifyState(state);
    if (verified.platform !== platform) {
      const dashboardUrl = new URL("/dashboard", request.url);
      dashboardUrl.searchParams.set("error", "invalid_state");
      dashboardUrl.searchParams.set("platform", platform);
      return NextResponse.redirect(dashboardUrl);
    }
  } catch {
    const dashboardUrl = new URL("/dashboard", request.url);
    dashboardUrl.searchParams.set("error", "invalid_state");
    dashboardUrl.searchParams.set("platform", platform);
    return NextResponse.redirect(dashboardUrl);
  }

  // 3. Session verification
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const signInUrl = new URL("/auth/sign-in", request.url);
    signInUrl.searchParams.set("redirect", "/dashboard");
    return NextResponse.redirect(signInUrl);
  }

  // 4. Token exchange via adapter
  registerDefaultAdapters();
  const adapter = getAdapter(platform as Platform);

  let exchangeResult;
  try {
    exchangeResult = await adapter.exchangeCode(code);
  } catch (err) {
    console.error(`[${platform}] exchangeCode error:`, err);
    const dashboardUrl = new URL("/dashboard", request.url);
    dashboardUrl.searchParams.set("error", "exchange_failed");
    dashboardUrl.searchParams.set("platform", platform);
    return NextResponse.redirect(dashboardUrl);
  }

  // 5. Encrypt tokens at rest (AES-256-GCM)
  const accessTokenEnc = encryptToken(exchangeResult.tokens.accessToken);
  const refreshTokenEnc = exchangeResult.tokens.refreshToken
    ? encryptToken(exchangeResult.tokens.refreshToken)
    : undefined;

  // 6. Best-effort profile fetch for avatar and initial metrics
  let avatarUrl: string | null = null;
  let initialAudienceCount: number | null = null;
  let initialExtras: Record<string, unknown> = {};

  try {
    const profile = await adapter.fetchProfile({
      id: "",
      platform: platform as Platform,
      externalId: exchangeResult.externalId,
      tokens: exchangeResult.tokens,
    });
    if (profile.avatarUrl) avatarUrl = profile.avatarUrl;
    if (typeof profile.audienceCount === "number") initialAudienceCount = profile.audienceCount;
    if (profile.extras) initialExtras = profile.extras;
  } catch {
    // Upstream profile fetch failure does not prevent connecting the account
  }

  // 7. Idempotent upsert (FSD §5 FR-2, CREAT-23 Requirement 4)
  // If provider did not issue a new refresh token on re-connect, preserve the existing one.
  let finalRefreshTokenEnc: string | null = refreshTokenEnc
    ? encodeBytea(refreshTokenEnc)
    : null;

  if (!refreshTokenEnc) {
    const { data: existing } = await supabase
      .from("connected_accounts")
      .select("refresh_token_enc")
      .eq("user_id", user.id)
      .eq("platform", platform)
      .eq("external_id", exchangeResult.externalId)
      .maybeSingle();

    if (existing?.refresh_token_enc) {
      finalRefreshTokenEnc = existing.refresh_token_enc;
    }
  }

  const { data: accountRow, error: upsertError } = await supabase
    .from("connected_accounts")
    .upsert(
      {
        user_id: user.id,
        platform: platform as Platform,
        external_id: exchangeResult.externalId,
        handle: exchangeResult.handle,
        avatar_url: avatarUrl,
        access_token_enc: encodeBytea(accessTokenEnc),
        refresh_token_enc: finalRefreshTokenEnc,
        token_expires_at: exchangeResult.tokens.expiresAt
          ? exchangeResult.tokens.expiresAt.toISOString()
          : null,
        status: "active",
        last_synced_at: new Date().toISOString(),
      },
      {
        onConflict: "user_id,platform,external_id",
      }
    )
    .select("id")
    .single();

  if (upsertError) {
    console.error(`[${platform}] DB upsert error:`, upsertError);
    const dashboardUrl = new URL("/dashboard", request.url);
    dashboardUrl.searchParams.set("error", "db_error");
    dashboardUrl.searchParams.set("platform", platform);
    return NextResponse.redirect(dashboardUrl);
  }

  // 8. Record initial snapshot if audienceCount was retrieved
  if (accountRow?.id && initialAudienceCount !== null) {
    const today = new Date().toISOString().slice(0, 10);
    await supabase.from("metric_snapshots").upsert(
      {
        connected_account_id: accountRow.id,
        captured_on: today,
        audience_count: initialAudienceCount,
        extras: initialExtras,
      },
      {
        onConflict: "connected_account_id,captured_on",
      }
    );
  }

  // 9. Success return to dashboard (CREAT-23 Requirement 3)
  const dashboardUrl = new URL("/dashboard", request.url);
  dashboardUrl.searchParams.set("connected", platform);
  return NextResponse.redirect(dashboardUrl);
}
