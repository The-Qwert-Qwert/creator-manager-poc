import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import {
  POST_AUTH_REDIRECT_COOKIE,
  safeRedirectPath,
} from "@/lib/auth/redirect";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  const cookieStore = await cookies();
  const destination = safeRedirectPath(
    cookieStore.get(POST_AUTH_REDIRECT_COOKIE)?.value,
  );

  if (!code) {
    return NextResponse.redirect(
      new URL(
        `/auth/sign-in?error=missing_code&redirect=${encodeURIComponent(destination)}`,
        origin,
      ),
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(
      new URL(
        `/auth/sign-in?error=exchange_failed&redirect=${encodeURIComponent(destination)}`,
        origin,
      ),
    );
  }

  const response = NextResponse.redirect(new URL(destination, origin));
  response.cookies.delete(POST_AUTH_REDIRECT_COOKIE);
  return response;
}
