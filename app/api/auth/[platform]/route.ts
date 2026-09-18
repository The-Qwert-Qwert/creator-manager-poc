import { NextResponse, type NextRequest } from "next/server";
import { PLATFORMS, type Platform } from "@/lib/adapters/types";
import { getAdapter, registerDefaultAdapters } from "@/lib/adapters/registry";
import { generateState } from "@/lib/auth/state";
import { createClient } from "@/lib/supabase/server";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ platform: string }> }
) {
  const { platform } = await context.params;

  if (!PLATFORMS.includes(platform as Platform)) {
    return NextResponse.json({ error: `Unknown platform: ${platform}` }, { status: 404 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const signInUrl = new URL("/auth/sign-in", request.url);
    signInUrl.searchParams.set("redirect", `/api/auth/${platform}`);
    return NextResponse.redirect(signInUrl);
  }

  registerDefaultAdapters();
  const adapter = getAdapter(platform as Platform);
  const state = generateState(platform as Platform);
  const authUrl = adapter.authUrl(state);

  return NextResponse.redirect(authUrl);
}
