import { NextResponse, type NextRequest } from "next/server";
import { PLATFORMS, type Platform } from "@/lib/adapters/types";
import { getAdapter, registerDefaultAdapters } from "@/lib/adapters/registry";
import { generateState } from "@/lib/auth/state";
import {
  postAuthRedirectCookie,
  safeRedirectPath,
} from "@/lib/auth/redirect";
import { config } from "@/lib/config";
import { createClient } from "@/lib/supabase/server";

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

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const destination = safeRedirectPath(`/api/auth/${platform}`);
    const signInUrl = new URL("/auth/sign-in", request.url);
    signInUrl.searchParams.set("redirect", destination);

    // Record the destination so the connect flow resumes after sign-in.
    const redirectResponse = NextResponse.redirect(signInUrl);
    const { name, value, options } = postAuthRedirectCookie(destination);
    redirectResponse.cookies.set(name, value, options);

    return redirectResponse;
  }

  try {
    registerDefaultAdapters();
    const adapter = getAdapter(platform as Platform);
    const state = generateState(platform as Platform);
    const authUrl = adapter.authUrl(state);

    return NextResponse.redirect(authUrl);
  } catch (err: unknown) {
    console.error(`[${platform}] OAuth start error:`, err);
    const dashboardUrl = new URL("/dashboard", request.url);
    dashboardUrl.searchParams.set("platform", platform);
    const isMissingEnv = err instanceof Error && err.message.includes("is not set");
    dashboardUrl.searchParams.set(
      "error",
      isMissingEnv ? "missing_credentials" : "auth_start_failed"
    );
    return NextResponse.redirect(dashboardUrl);
  }
}
