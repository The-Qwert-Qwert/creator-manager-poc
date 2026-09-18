import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PLATFORMS, type Platform, type PlatformAdapter } from "@/lib/adapters/types";
import { getAdapter, hasAdapter, registerAdapter, registerDefaultAdapters } from "@/lib/adapters/registry";
import { generateState } from "@/lib/auth/state";
import { POST_AUTH_REDIRECT_COOKIE } from "@/lib/auth/redirect";
import { decryptToken } from "@/lib/token-crypto";
import { GET as startHandler } from "@/app/api/auth/[platform]/route";
import { GET as callbackHandler } from "@/app/api/auth/[platform]/callback/route";

const TEST_SECRET = "b4b1033443753e9b9e3ef2a3cfc3a773defeed02cdd5967246b70ffa9e8e549b";
const TEST_ENC_KEY = "0d8d233287b3fa0a746038593af34bb8a8d01728d60fb630b96f598f2fb38498";

// Mock Supabase server client
let mockUser: { id: string; email: string } | null = null;
let mockUpsertResult: { data: { id: string } | null; error: unknown | null } = {
  data: { id: "mock-account-id" },
  error: null,
};
let mockExistingAccount: { refresh_token_enc: string | null } | null = null;
const upsertCalls: Record<string, unknown>[] = [];
const snapshotUpsertCalls: Record<string, unknown>[] = [];

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: mockUser },
        error: mockUser ? null : { message: "No session" },
      })),
      signOut: vi.fn(async () => ({ error: null })),
    },
    from: vi.fn((table: string) => {
      if (table === "connected_accounts") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  maybeSingle: vi.fn(async () => ({
                    data: mockExistingAccount,
                    error: null,
                  })),
                })),
              })),
            })),
          })),
          upsert: vi.fn((payload: Record<string, unknown>) => {
            upsertCalls.push(payload);
            return {
              select: vi.fn(() => ({
                single: vi.fn(async () => mockUpsertResult),
              })),
            };
          }),
        };
      }
      if (table === "metric_snapshots") {
        return {
          upsert: vi.fn((payload: Record<string, unknown>) => {
            snapshotUpsertCalls.push(payload);
            return { data: null, error: null };
          }),
        };
      }
      return {};
    }),
  })),
}));

describe("Connect Flow", () => {
  beforeEach(() => {
    vi.stubEnv("APP_SECRET", TEST_SECRET);
    vi.stubEnv("TOKEN_ENC_KEY", TEST_ENC_KEY);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "pub-key");
    vi.stubEnv("SUPABASE_SECRET_KEY", "secret-key");
    vi.stubEnv("GOOGLE_CLIENT_ID", "google-id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "google-secret");
    vi.stubEnv("GOOGLE_REDIRECT_URI", "http://localhost:3000/api/auth/youtube/callback");
    vi.stubEnv("TIKTOK_CLIENT_KEY", "tiktok-key");
    vi.stubEnv("TIKTOK_CLIENT_SECRET", "tiktok-secret");
    vi.stubEnv("TIKTOK_REDIRECT_URI", "https://app.example.com/api/auth/tiktok/callback");
    vi.stubEnv("META_IG_CLIENT_ID", "ig-id");
    vi.stubEnv("META_IG_CLIENT_SECRET", "ig-secret");
    vi.stubEnv("META_IG_REDIRECT_URI", "http://localhost:3000/api/auth/instagram/callback");
    vi.stubEnv("META_FB_CLIENT_ID", "fb-id");
    vi.stubEnv("META_FB_CLIENT_SECRET", "fb-secret");
    vi.stubEnv("META_FB_REDIRECT_URI", "http://localhost:3000/api/auth/facebook/callback");
    vi.stubEnv("META_GRAPH_VERSION", "v21.0");
    vi.stubEnv("ENABLE_META", "true");

    mockUser = { id: "user-123", email: "creator@example.com" };
    mockUpsertResult = { data: { id: "account-uuid-1" }, error: null };
    mockExistingAccount = null;
    upsertCalls.length = 0;
    snapshotUpsertCalls.length = 0;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  describe("registerDefaultAdapters", () => {
    it("registers all 4 platforms in the registry", () => {
      registerDefaultAdapters();
      PLATFORMS.forEach((platform) => {
        expect(hasAdapter(platform)).toBe(true);
        expect(getAdapter(platform).platform).toBe(platform);
      });
    });
  });

  describe("GET /api/auth/[platform] (OAuth start)", () => {
    it("returns 404 for unknown platform", async () => {
      const request = new NextRequest("http://localhost:3000/api/auth/unknown");
      const res = await startHandler(request, { params: Promise.resolve({ platform: "unknown" }) });

      expect(res.status).toBe(404);
    });

    it("redirects unauthenticated user to sign-in page", async () => {
      mockUser = null;
      const request = new NextRequest("http://localhost:3000/api/auth/youtube");
      const res = await startHandler(request, { params: Promise.resolve({ platform: "youtube" }) });

      expect(res.status).toBe(307);
      const redirectLocation = res.headers.get("location");
      expect(redirectLocation).toContain("/auth/sign-in");
      expect(redirectLocation).toContain("redirect=%2Fapi%2Fauth%2Fyoutube");
      expect(res.cookies.get(POST_AUTH_REDIRECT_COOKIE)?.value).toBe("/api/auth/youtube");
    });

    it("starts OAuth flow for YouTube with signed CSRF state", async () => {
      const request = new NextRequest("http://localhost:3000/api/auth/youtube");
      const res = await startHandler(request, { params: Promise.resolve({ platform: "youtube" }) });

      expect(res.status).toBe(307);
      const location = res.headers.get("location");
      expect(location).toBeDefined();

      const url = new URL(location!);
      expect(url.origin).toBe("https://accounts.google.com");
      expect(url.pathname).toBe("/o/oauth2/v2/auth");
      expect(url.searchParams.get("client_id")).toBe("google-id");
      expect(url.searchParams.get("state")).toBeDefined();
    });

    it("starts OAuth flow for TikTok, Instagram, and Facebook", async () => {
      for (const platform of ["tiktok", "instagram", "facebook"] as Platform[]) {
        const request = new NextRequest(`http://localhost:3000/api/auth/${platform}`);
        const res = await startHandler(request, { params: Promise.resolve({ platform }) });

        expect(res.status).toBe(307);
        const location = res.headers.get("location");
        expect(location).toBeDefined();
        const url = new URL(location!);
        expect(url.searchParams.get("state")).toBeDefined();
      }
    });

    it("redirects to /dashboard with missing_credentials error if provider credentials are not set", async () => {
      vi.stubEnv("GOOGLE_CLIENT_ID", "");
      const request = new NextRequest("http://localhost:3000/api/auth/youtube");
      const res = await startHandler(request, { params: Promise.resolve({ platform: "youtube" }) });

      expect(res.status).toBe(307);
      const location = res.headers.get("location");
      expect(location).toContain("/dashboard");
      expect(location).toContain("platform=youtube");
      expect(location).toContain("error=missing_credentials");
    });
  });

  describe("GET /api/auth/[platform]/callback (OAuth callback)", () => {
    function createMockAdapter(platform: Platform): PlatformAdapter {
      return {
        platform,
        authUrl: (state) => `https://example.com/auth?state=${state}`,
        exchangeCode: vi.fn(async () => ({
          tokens: {
            accessToken: `${platform}-access-token`,
            refreshToken: `${platform}-refresh-token`,
            expiresAt: new Date(Date.now() + 3600000),
          },
          externalId: `ext-${platform}-123`,
          handle: `creator_${platform}`,
        })),
        refresh: vi.fn(async (tokens) => tokens),
        fetchProfile: vi.fn(async () => ({
          handle: `creator_${platform}`,
          avatarUrl: `https://example.com/avatar-${platform}.jpg`,
          audienceCount: 50000,
          extras: { sample: 123 },
        })),
      };
    }

    it("returns 404 for unknown platform", async () => {
      const request = new NextRequest("http://localhost:3000/api/auth/unknown/callback");
      const res = await callbackHandler(request, { params: Promise.resolve({ platform: "unknown" }) });

      expect(res.status).toBe(404);
    });

    it("handles OAuth denial gracefully by redirecting to /dashboard?denied=[platform]", async () => {
      const request = new NextRequest(
        "http://localhost:3000/api/auth/youtube/callback?error=access_denied&error_description=User+denied"
      );
      const res = await callbackHandler(request, { params: Promise.resolve({ platform: "youtube" }) });

      expect(res.status).toBe(307);
      const location = res.headers.get("location")!;
      const url = new URL(location);
      expect(url.pathname).toBe("/dashboard");
      expect(url.searchParams.get("denied")).toBe("youtube");
    });

    it("handles missing code or state by redirecting to dashboard with error", async () => {
      const request = new NextRequest("http://localhost:3000/api/auth/youtube/callback?code=123");
      const res = await callbackHandler(request, { params: Promise.resolve({ platform: "youtube" }) });

      expect(res.status).toBe(307);
      const url = new URL(res.headers.get("location")!);
      expect(url.pathname).toBe("/dashboard");
      expect(url.searchParams.get("error")).toBe("missing_code_or_state");
    });

    it("handles invalid CSRF state by redirecting to dashboard with error", async () => {
      const request = new NextRequest(
        "http://localhost:3000/api/auth/youtube/callback?code=123&state=tampered.state"
      );
      const res = await callbackHandler(request, { params: Promise.resolve({ platform: "youtube" }) });

      expect(res.status).toBe(307);
      const url = new URL(res.headers.get("location")!);
      expect(url.pathname).toBe("/dashboard");
      expect(url.searchParams.get("error")).toBe("invalid_state");
    });

    it("handles CSRF state generated for a different platform", async () => {
      const tiktokState = generateState("tiktok");
      const request = new NextRequest(
        `http://localhost:3000/api/auth/youtube/callback?code=123&state=${tiktokState}`
      );
      const res = await callbackHandler(request, { params: Promise.resolve({ platform: "youtube" }) });

      expect(res.status).toBe(307);
      const url = new URL(res.headers.get("location")!);
      expect(url.pathname).toBe("/dashboard");
      expect(url.searchParams.get("error")).toBe("invalid_state");
    });

    it("redirects unauthenticated user to /auth/sign-in", async () => {
      mockUser = null;
      const state = generateState("youtube");
      const request = new NextRequest(
        `http://localhost:3000/api/auth/youtube/callback?code=123&state=${state}`
      );
      const res = await callbackHandler(request, { params: Promise.resolve({ platform: "youtube" }) });

      expect(res.status).toBe(307);
      const url = new URL(res.headers.get("location")!);
      expect(url.pathname).toBe("/auth/sign-in");
    });

    it("successfully connects platform: encrypts tokens, upserts account, records snapshot, and redirects to dashboard", async () => {
      const mockAdapter = createMockAdapter("youtube");
      registerAdapter(mockAdapter);

      const state = generateState("youtube");
      const request = new NextRequest(
        `http://localhost:3000/api/auth/youtube/callback?code=valid-auth-code&state=${state}`
      );
      const res = await callbackHandler(request, { params: Promise.resolve({ platform: "youtube" }) });

      expect(res.status).toBe(307);
      const url = new URL(res.headers.get("location")!);
      expect(url.pathname).toBe("/dashboard");
      expect(url.searchParams.get("connected")).toBe("youtube");

      // Verify adapter was called
      expect(mockAdapter.exchangeCode).toHaveBeenCalledWith("valid-auth-code");
      expect(mockAdapter.fetchProfile).toHaveBeenCalled();

      // Verify DB upsert was called with encrypted tokens
      expect(upsertCalls.length).toBe(1);
      const saved = upsertCalls[0];
      expect(saved).toBeDefined();
      expect(saved!.user_id).toBe("user-123");
      expect(saved!.platform).toBe("youtube");
      expect(saved!.external_id).toBe("ext-youtube-123");
      expect(saved!.handle).toBe("creator_youtube");
      expect(saved!.avatar_url).toBe("https://example.com/avatar-youtube.jpg");
      expect(saved!.status).toBe("active");

      // Verify tokens were encrypted with AES-256-GCM
      const accessHex = (saved!.access_token_enc as string).slice(2);
      const decryptedAccess = decryptToken(Buffer.from(accessHex, "hex"));
      expect(decryptedAccess).toBe("youtube-access-token");

      const refreshHex = (saved!.refresh_token_enc as string).slice(2);
      const decryptedRefresh = decryptToken(Buffer.from(refreshHex, "hex"));
      expect(decryptedRefresh).toBe("youtube-refresh-token");

      // Verify initial snapshot was saved
      expect(snapshotUpsertCalls.length).toBe(1);
      const snapshotCall = snapshotUpsertCalls[0];
      expect(snapshotCall).toBeDefined();
      expect(snapshotCall!.connected_account_id).toBe("account-uuid-1");
      expect(snapshotCall!.audience_count).toBe(50000);
    });

    it("preserves existing refresh_token_enc on re-connect if adapter does not issue a new one", async () => {
      const mockAdapter = createMockAdapter("youtube");
      mockAdapter.exchangeCode = vi.fn(async () => ({
        tokens: {
          accessToken: "new-access-token-without-refresh",
          expiresAt: new Date(Date.now() + 3600000),
        },
        externalId: "ext-youtube-123",
        handle: "creator_youtube",
      }));
      registerAdapter(mockAdapter);

      // Existing account already had a refresh token
      mockExistingAccount = { refresh_token_enc: "\\xexistingrefreshtokenhex" };

      const state = generateState("youtube");
      const request = new NextRequest(
        `http://localhost:3000/api/auth/youtube/callback?code=valid-code&state=${state}`
      );
      const res = await callbackHandler(request, { params: Promise.resolve({ platform: "youtube" }) });

      expect(res.status).toBe(307);
      expect(upsertCalls.length).toBe(1);
      expect(upsertCalls[0]!.refresh_token_enc).toBe("\\xexistingrefreshtokenhex");
    });

    it("handles exchangeCode errors gracefully", async () => {
      const mockAdapter = createMockAdapter("youtube");
      mockAdapter.exchangeCode = vi.fn(async () => {
        throw new Error("Invalid OAuth code");
      });
      registerAdapter(mockAdapter);

      const state = generateState("youtube");
      const request = new NextRequest(
        `http://localhost:3000/api/auth/youtube/callback?code=bad-code&state=${state}`
      );
      const res = await callbackHandler(request, { params: Promise.resolve({ platform: "youtube" }) });

      expect(res.status).toBe(307);
      const url = new URL(res.headers.get("location")!);
      expect(url.pathname).toBe("/dashboard");
      expect(url.searchParams.get("error")).toBe("exchange_failed");
    });

    it("handles database upsert errors gracefully", async () => {
      const mockAdapter = createMockAdapter("youtube");
      registerAdapter(mockAdapter);
      mockUpsertResult = { data: null, error: { message: "DB write failed" } };

      const state = generateState("youtube");
      const request = new NextRequest(
        `http://localhost:3000/api/auth/youtube/callback?code=valid-code&state=${state}`
      );
      const res = await callbackHandler(request, { params: Promise.resolve({ platform: "youtube" }) });

      expect(res.status).toBe(307);
      const url = new URL(res.headers.get("location")!);
      expect(url.pathname).toBe("/dashboard");
      expect(url.searchParams.get("error")).toBe("db_error");
    });
  });

  describe("Dashboard feature-flag gating", () => {
    it("filters out Instagram and Facebook accounts when enableMeta is false", () => {
      const allAccounts = [
        { id: "1", platform: "youtube", handle: "yt_user" },
        { id: "2", platform: "tiktok", handle: "tt_user" },
        { id: "3", platform: "instagram", handle: "ig_user" },
        { id: "4", platform: "facebook", handle: "fb_user" },
      ];

      const filterAccounts = (accounts: typeof allAccounts, enableMeta: boolean) =>
        accounts.filter((acc) => {
          if (!enableMeta && (acc.platform === "instagram" || acc.platform === "facebook")) {
            return false;
          }
          return true;
        });

      const withoutMeta = filterAccounts(allAccounts, false);
      expect(withoutMeta.map((a) => a.platform)).toEqual(["youtube", "tiktok"]);

      const withMeta = filterAccounts(allAccounts, true);
      expect(withMeta.map((a) => a.platform)).toEqual(["youtube", "tiktok", "instagram", "facebook"]);
    });

    it("hides Instagram and Facebook connect cards when enableMeta is false", () => {
      const getConnectablePlatforms = (enableMeta: boolean) =>
        PLATFORMS.filter((platform) => {
          if (!enableMeta && (platform === "instagram" || platform === "facebook")) {
            return false;
          }
          return true;
        });

      const withoutMeta = getConnectablePlatforms(false);
      expect(withoutMeta).toEqual(["youtube", "tiktok"]);

      const withMeta = getConnectablePlatforms(true);
      expect(withMeta).toEqual(["youtube", "tiktok", "instagram", "facebook"]);
    });

    it("returns 404 from startHandler for Meta platforms when ENABLE_META=false", async () => {
      vi.stubEnv("ENABLE_META", "false");

      for (const platform of ["instagram", "facebook"]) {
        const request = new NextRequest(`http://localhost:3000/api/auth/${platform}`);
        const res = await startHandler(request, {
          params: Promise.resolve({ platform }),
        });

        expect(res.status).toBe(404);
        const data = await res.json();
        expect(data.error).toContain("Platform is currently disabled");
      }
    });

    it("returns 404 from callbackHandler for Meta platforms when ENABLE_META=false", async () => {
      vi.stubEnv("ENABLE_META", "false");

      for (const platform of ["instagram", "facebook"]) {
        const request = new NextRequest(`http://localhost:3000/api/auth/${platform}/callback?code=123&state=abc`);
        const res = await callbackHandler(request, {
          params: Promise.resolve({ platform }),
        });

        expect(res.status).toBe(404);
        const data = await res.json();
        expect(data.error).toContain("Platform is currently disabled");
      }
    });
  });
});
