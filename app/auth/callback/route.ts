import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import {
  POST_AUTH_REDIRECT_COOKIE,
  safeRedirectPath,
} from "@/lib/auth/redirect";
import { createClient } from "@/lib/supabase/server";

function signInPath(reason: string, destination: string): string {
  return `/auth/sign-in?error=${reason}&redirect=${encodeURIComponent(destination)}`;
}

/** Supabase reports an expired or already-used link as an error_code, not a code. */
function failureReason(searchParams: URLSearchParams): string {
  const reported = searchParams.get("error_code") ?? searchParams.get("error");
  return reported === "otp_expired" ? "link_expired" : "missing_code";
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  const cookieStore = await cookies();
  const destination = safeRedirectPath(
    cookieStore.get(POST_AUTH_REDIRECT_COOKIE)?.value,
  );

  if (!code) {
    return NextResponse.redirect(
      new URL(signInPath(failureReason(searchParams), destination), origin),
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    // The cookie survives, so retrying still lands where the user was headed.
    return NextResponse.redirect(
      new URL(signInPath("exchange_failed", destination), origin),
    );
  }

  const response = NextResponse.redirect(new URL(destination, origin));
  response.cookies.delete(POST_AUTH_REDIRECT_COOKIE);
  return response;
}
