import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  user: null as { id: string } | null,
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: state.user } }),
    },
  }),
}));

vi.mock("@/lib/config", () => ({
  config: {
    supabase: { url: "https://example.supabase.co", publishableKey: "publishable-key" },
  },
}));

import {
  POST_AUTH_REDIRECT_COOKIE,
  POST_AUTH_REDIRECT_MAX_AGE_SECONDS,
} from "@/lib/auth/redirect";
import { config as proxyConfig, proxy } from "@/proxy";

const BASE = "http://localhost:3000";

function requestFor(path: string): NextRequest {
  return new NextRequest(`${BASE}${path}`);
}

function locationOf(response: Response): URL {
  return new URL(response.headers.get("location")!);
}

describe("proxy route guard", () => {
  beforeEach(() => {
    state.user = null;
  });

  it("sends an unauthenticated visitor to sign-in and remembers where they were going", async () => {
    const response = await proxy(requestFor("/dashboard"));

    expect(response.status).toBe(307);
    expect(locationOf(response).pathname).toBe("/auth/sign-in");
    expect(locationOf(response).searchParams.get("redirect")).toBe("/dashboard");
    expect(response.cookies.get(POST_AUTH_REDIRECT_COOKIE)?.value).toBe("/dashboard");
  });

  it("keeps the query string in the destination instead of leaking it onto the sign-in URL", async () => {
    const response = await proxy(requestFor("/dashboard?refresh=cooldown&platform=tiktok"));

    const location = locationOf(response);

    expect(location.pathname).toBe("/auth/sign-in");
    expect(location.searchParams.get("redirect")).toBe(
      "/dashboard?refresh=cooldown&platform=tiktok",
    );
    expect(location.searchParams.get("refresh")).toBeNull();
    expect(location.searchParams.get("platform")).toBeNull();
    expect(response.cookies.get(POST_AUTH_REDIRECT_COOKIE)?.value).toBe(
      "/dashboard?refresh=cooldown&platform=tiktok",
    );
  });

  it("stores the destination in a short-lived, script-readable-by-nobody cookie", async () => {
    const response = await proxy(requestFor("/dashboard"));
    const cookie = response.cookies.get(POST_AUTH_REDIRECT_COOKIE);

    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("lax");
    expect(cookie?.path).toBe("/");
    expect(cookie?.maxAge).toBe(POST_AUTH_REDIRECT_MAX_AGE_SECONDS);
  });

  it("leaves a protected request alone once there is a user", async () => {
    state.user = { id: "user-1" };

    const response = await proxy(requestFor("/dashboard"));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("returns a signed-in user from the sign-in page to the dashboard", async () => {
    state.user = { id: "user-1" };

    const response = await proxy(requestFor("/auth/sign-in"));

    expect(response.status).toBe(307);
    expect(locationOf(response).pathname).toBe("/dashboard");
  });

  it("resumes the connect flow for a signed-in user who lands on sign-in with a destination", async () => {
    state.user = { id: "user-1" };

    const response = await proxy(
      requestFor("/auth/sign-in?redirect=%2Fapi%2Fauth%2Fyoutube"),
    );

    expect(locationOf(response).pathname).toBe("/api/auth/youtube");
  });

  it("refuses an off-origin destination rather than echoing it back", async () => {
    state.user = { id: "user-1" };

    const response = await proxy(
      requestFor("/auth/sign-in?redirect=https%3A%2F%2Fevil.com"),
    );

    expect(locationOf(response).host).toBe("localhost:3000");
    expect(locationOf(response).pathname).toBe("/dashboard");
  });

  it("sends the root to the dashboard instead of serving a landing page", async () => {
    const response = await proxy(requestFor("/"));

    expect(response.status).toBe(307);
    expect(locationOf(response).pathname).toBe("/dashboard");
  });

  it("leaves other unprotected routes alone", async () => {
    const response = await proxy(requestFor("/auth/callback"));

    expect(response.status).toBe(200);
    expect(response.cookies.get(POST_AUTH_REDIRECT_COOKIE)).toBeUndefined();
  });

  it("matches protected paths by whole segment, not by prefix", async () => {
    const nearMiss = await proxy(requestFor("/dashboardish"));
    const nested = await proxy(requestFor("/dashboard/settings"));

    expect(nearMiss.status).toBe(200);
    expect(nested.status).toBe(307);
    expect(locationOf(nested).searchParams.get("redirect")).toBe("/dashboard/settings");
  });

  it("keeps static assets and Next internals out of the matcher", () => {
    const matcher = new RegExp(`^${proxyConfig.matcher[0]!}$`);

    expect(matcher.test("/dashboard")).toBe(true);
    expect(matcher.test("/auth/sign-in")).toBe(true);
    expect(matcher.test("/_next/static/chunk.js")).toBe(false);
    expect(matcher.test("/_next/data/build/dashboard.json")).toBe(false);
    expect(matcher.test("/logo.svg")).toBe(false);
    expect(matcher.test("/favicon.ico")).toBe(false);
  });
});
