import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  DEFAULT_SIGNED_IN_PATH,
  POST_AUTH_REDIRECT_COOKIE,
  POST_AUTH_REDIRECT_MAX_AGE_SECONDS,
  safeRedirectPath,
} from "@/lib/auth/redirect";
import { config as appConfig } from "@/lib/config";

const PROTECTED = ["/dashboard"];
const SIGNED_IN_ONLY = ["/auth/sign-in"];

/** A redirect is still a response — keep any session cookie refreshed above. */
function carryingCookies(from: NextResponse, to: NextResponse): NextResponse {
  for (const cookie of from.cookies.getAll()) {
    to.cookies.set(cookie);
  }
  return to;
}

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    appConfig.supabase.url,
    appConfig.supabase.publishableKey,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet) => {
          toSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          toSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  const { pathname, searchParams } = request.nextUrl;

  // No landing page: the root belongs to the app, not to a scaffold notice.
  if (pathname === "/") {
    return carryingCookies(
      response,
      NextResponse.redirect(new URL(DEFAULT_SIGNED_IN_PATH, request.url)),
    );
  }

  if (user && SIGNED_IN_ONLY.some((p) => pathname.startsWith(p))) {
    const destination = safeRedirectPath(searchParams.get("redirect"));
    return carryingCookies(response, NextResponse.redirect(new URL(destination, request.url)));
  }

  if (!user && PROTECTED.some((p) => pathname.startsWith(p))) {
    const destination = safeRedirectPath(`${pathname}${request.nextUrl.search}`);

    const signInUrl = request.nextUrl.clone();
    signInUrl.pathname = "/auth/sign-in";
    signInUrl.search = "";
    signInUrl.searchParams.set("redirect", destination);

    const redirectResponse = carryingCookies(response, NextResponse.redirect(signInUrl));

    redirectResponse.cookies.set(POST_AUTH_REDIRECT_COOKIE, destination, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: POST_AUTH_REDIRECT_MAX_AGE_SECONDS,
    });

    return redirectResponse;
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|_next/data|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|txt|xml|webmanifest)$).*)",
  ],
};
