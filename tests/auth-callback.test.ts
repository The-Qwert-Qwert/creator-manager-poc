import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { state, COOKIE_NAME } = vi.hoisted(() => ({
  state: {
    redirectCookie: null as string | null,
    exchangeError: null as { message: string } | null,
    exchangeCalls: 0,
  },
  COOKIE_NAME: "post_auth_redirect",
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      if (name !== COOKIE_NAME) return undefined;
      if (state.redirectCookie === null) return undefined;
      return { name, value: state.redirectCookie };
    },
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      exchangeCodeForSession: async () => {
        state.exchangeCalls += 1;
        return { error: state.exchangeError };
      },
    },
  }),
}));

import { POST_AUTH_REDIRECT_COOKIE } from "@/lib/auth/redirect";
import { GET } from "@/app/auth/callback/route";

const BASE = "http://localhost:3000";

function requestFor(query = "?code=abc"): NextRequest {
  return new NextRequest(`${BASE}/auth/callback${query}`);
}

function locationOf(response: Response): URL {
  return new URL(response.headers.get("location")!);
}

describe("GET /auth/callback", () => {
  beforeEach(() => {
    state.redirectCookie = null;
    state.exchangeError = null;
    state.exchangeCalls = 0;
  });

  it("honours a safe destination from the cookie", async () => {
    state.redirectCookie = "/dashboard?refresh=cooldown";

    const response = await GET(requestFor("?code=abc"));

    expect(response.status).toBe(307);
    const location = locationOf(response);
    expect(location.pathname).toBe("/dashboard");
    expect(location.search).toBe("?refresh=cooldown");
    expect(state.exchangeCalls).toBe(1);
  });

  it("falls back to /dashboard when the cookie is absent", async () => {
    const response = await GET(requestFor("?code=abc"));

    expect(response.status).toBe(307);
    expect(locationOf(response).pathname).toBe("/dashboard");
    expect(state.exchangeCalls).toBe(1);
  });

  it("refuses an off-origin cookie value", async () => {
    state.redirectCookie = "https://evil.com";

    const response = await GET(requestFor("?code=abc"));

    expect(response.status).toBe(307);
    const location = locationOf(response);
    expect(location.host).toBe("localhost:3000");
    expect(location.pathname).toBe("/dashboard");
  });

  it("refuses a protocol-relative cookie value", async () => {
    state.redirectCookie = "//evil.com/steal";

    const response = await GET(requestFor("?code=abc"));

    expect(response.status).toBe(307);
    const location = locationOf(response);
    expect(location.host).toBe("localhost:3000");
    expect(location.pathname).toBe("/dashboard");
  });

  it("redirects to sign-in with missing_code when there is no code", async () => {
    state.redirectCookie = "/dashboard?refresh=cooldown";

    const response = await GET(new NextRequest(`${BASE}/auth/callback`));

    expect(response.status).toBe(307);
    const location = locationOf(response);
    expect(location.pathname).toBe("/auth/sign-in");
    expect(location.searchParams.get("error")).toBe("missing_code");
    expect(location.searchParams.get("redirect")).toBe("/dashboard?refresh=cooldown");
    expect(state.exchangeCalls).toBe(0);
  });

  it("reports an expired link as expired rather than as incomplete", async () => {
    state.redirectCookie = "/dashboard";

    const response = await GET(
      new NextRequest(`${BASE}/auth/callback?error=access_denied&error_code=otp_expired`),
    );

    expect(response.status).toBe(307);
    expect(locationOf(response).searchParams.get("error")).toBe("link_expired");
    expect(state.exchangeCalls).toBe(0);
  });

  it("redirects to sign-in with exchange_failed when the exchange errors", async () => {
    state.redirectCookie = "/dashboard";
    state.exchangeError = { message: "invalid_grant" };

    const response = await GET(requestFor("?code=abc"));

    expect(response.status).toBe(307);
    const location = locationOf(response);
    expect(location.pathname).toBe("/auth/sign-in");
    expect(location.searchParams.get("error")).toBe("exchange_failed");
  });

  it("keeps the destination recoverable when the exchange fails", async () => {
    state.redirectCookie = "/dashboard";
    state.exchangeError = { message: "invalid_grant" };

    const response = await GET(requestFor("?code=abc"));

    // The route must not emit a deletion for the destination cookie on failure.
    expect(response.cookies.get(POST_AUTH_REDIRECT_COOKIE)).toBeUndefined();
  });

  it("clears the cookie on success", async () => {
    state.redirectCookie = "/dashboard";

    const response = await GET(requestFor("?code=abc"));

    const cookie = response.cookies.get(POST_AUTH_REDIRECT_COOKIE);
    expect(cookie).toBeDefined();
    expect(cookie?.value).toBe("");
  });
});
