import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TikTokAdapter, tiktokAdapter } from "@/lib/adapters/tiktok";
import { AdapterError, type ConnectedAccount } from "@/lib/adapters/types";
import { errorRecording, recordedBody, tiktokRecording } from "./fixtures";

describe("TikTokAdapter", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.stubEnv("TIKTOK_CLIENT_KEY", "test-tiktok-client-key");
    vi.stubEnv("TIKTOK_CLIENT_SECRET", "test-tiktok-client-secret");
    vi.stubEnv(
      "TIKTOK_REDIRECT_URI",
      "https://app.example.com/api/auth/tiktok/callback"
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("has platform property set to tiktok", () => {
    expect(tiktokAdapter.platform).toBe("tiktok");
    expect(new TikTokAdapter().platform).toBe("tiktok");
  });

  describe("authUrl", () => {
    it("builds the correct TikTok OAuth 2.0 authorization URL", () => {
      const state = "random-csrf-state-123";
      const urlString = tiktokAdapter.authUrl(state);
      const url = new URL(urlString);

      expect(url.origin).toBe("https://www.tiktok.com");
      expect(url.pathname).toBe("/v2/auth/authorize/");
      expect(url.searchParams.get("client_key")).toBe("test-tiktok-client-key");
      expect(url.searchParams.get("redirect_uri")).toBe(
        "https://app.example.com/api/auth/tiktok/callback"
      );
      expect(url.searchParams.get("response_type")).toBe("code");
      expect(url.searchParams.get("scope")).toBe(
        "user.info.basic,user.info.stats,video.list"
      );
      expect(url.searchParams.get("state")).toBe(state);
    });
  });

  describe("exchangeCode", () => {
    it("exchanges authorization code for tokens and user profile info", async () => {
      const exchangeResponses = tiktokRecording.exchangeCode.success;

      const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        if (url === "https://open.tiktokapis.com/v2/oauth/token/") {
          expect(init?.method).toBe("POST");
          expect(init?.headers).toEqual({
            "Content-Type": "application/x-www-form-urlencoded",
          });
          const bodyParams = new URLSearchParams(init?.body as string);
          expect(bodyParams.get("client_key")).toBe("test-tiktok-client-key");
          expect(bodyParams.get("client_secret")).toBe("test-tiktok-client-secret");
          expect(bodyParams.get("code")).toBe("auth-code-xyz");
          expect(bodyParams.get("grant_type")).toBe("authorization_code");
          expect(bodyParams.get("redirect_uri")).toBe(
            "https://app.example.com/api/auth/tiktok/callback"
          );

          return Promise.resolve(
            new Response(JSON.stringify(recordedBody(exchangeResponses, 0)), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            })
          );
        }

        if (url.startsWith("https://open.tiktokapis.com/v2/user/info/")) {
          const parsedUrl = new URL(url);
          expect(parsedUrl.searchParams.get("fields")).toBe("open_id,display_name");
          expect((init?.headers as Record<string, string>)?.[
            "Authorization"
          ]).toBe("Bearer act.mock_access_token_123");

          return Promise.resolve(
            new Response(JSON.stringify(recordedBody(exchangeResponses, 1)), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            })
          );
        }

        return Promise.reject(new Error(`Unhandled URL: ${url}`));
      });

      global.fetch = fetchMock;

      const before = Date.now();
      const result = await tiktokAdapter.exchangeCode("auth-code-xyz");
      const after = Date.now();

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(result.externalId).toBe("tiktok_open_id_abc");
      expect(result.handle).toBe("Creator TikTok");
      expect(result.tokens.accessToken).toBe("act.mock_access_token_123");
      expect(result.tokens.refreshToken).toBe("rft.mock_refresh_token_456");
      expect(result.tokens.expiresAt).toBeInstanceOf(Date);
      const expiresAtMs = result.tokens.expiresAt!.getTime();
      expect(expiresAtMs).toBeGreaterThanOrEqual(before + 86400 * 1000);
      expect(expiresAtMs).toBeLessThanOrEqual(after + 86400 * 1000);
    });

    it("falls back to open_id for handle when display_name is empty", async () => {
      const mockTokenResponse = {
        access_token: "act.token",
        open_id: "open_id_fallback",
        refresh_token: "rft.token",
      };

      const mockUserInfoResponse = {
        data: {
          user: {
            open_id: "open_id_fallback",
            display_name: "",
          },
        },
        error: { code: "ok" },
      };

      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url === "https://open.tiktokapis.com/v2/oauth/token/") {
          return Promise.resolve(
            new Response(JSON.stringify(mockTokenResponse), { status: 200 })
          );
        }
        return Promise.resolve(
          new Response(JSON.stringify(mockUserInfoResponse), { status: 200 })
        );
      });

      const result = await tiktokAdapter.exchangeCode("code");
      expect(result.handle).toBe("open_id_fallback");
      expect(result.tokens.expiresAt).toBeUndefined();
    });

    it("throws AdapterError UPSTREAM_ERROR when token endpoint returns error payload", async () => {
      global.fetch = vi.fn().mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify(recordedBody(errorRecording(tiktokRecording, "exchangeCode", "upstream"), 0)),
            {
              status: 400,
              headers: { "Content-Type": "application/json" },
            }
          )
        )
      );

      try {
        await tiktokAdapter.exchangeCode("bad-code");
        expect.unreachable("should have thrown");
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(AdapterError);
        const adapterError = err as AdapterError;
        expect(adapterError.platform).toBe("tiktok");
        expect(adapterError.code).toBe("UPSTREAM_ERROR");
        expect(adapterError.message).toContain("Authorization code has been used.");
      }
    });

    it("throws AdapterError UPSTREAM_ERROR when token response lacks access_token or open_id", async () => {
      global.fetch = vi.fn().mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify({ expires_in: 86400 }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        )
      );

      try {
        await tiktokAdapter.exchangeCode("valid-code");
        expect.unreachable("should have thrown");
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(AdapterError);
        const adapterError = err as AdapterError;
        expect(adapterError.platform).toBe("tiktok");
        expect(adapterError.code).toBe("UPSTREAM_ERROR");
        expect(adapterError.message).toContain("malformed token response");
      }
    });

    it("throws AdapterError UPSTREAM_ERROR when user info request fails after token exchange", async () => {
      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url === "https://open.tiktokapis.com/v2/oauth/token/") {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                access_token: "act.token",
                open_id: "open_id_1",
              }),
              { status: 200 }
            )
          );
        }
        return Promise.resolve(
          new Response("Internal Server Error", {
            status: 500,
            statusText: "Internal Server Error",
          })
        );
      });

      try {
        await tiktokAdapter.exchangeCode("code");
        expect.unreachable("should have thrown");
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(AdapterError);
        const adapterError = err as AdapterError;
        expect(adapterError.code).toBe("UPSTREAM_ERROR");
      }
    });
  });

  describe("refresh", () => {
    it("throws AdapterError REVOKED when refreshToken is missing", async () => {
      try {
        await tiktokAdapter.refresh({ accessToken: "access-only" });
        expect.unreachable("should have thrown");
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(AdapterError);
        const adapterError = err as AdapterError;
        expect(adapterError.platform).toBe("tiktok");
        expect(adapterError.code).toBe("REVOKED");
        expect(adapterError.message).toContain("refresh token missing");
      }
    });

    it("refreshes tokens and updates rotated refresh_token and expiresAt", async () => {
      const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        expect(url).toBe("https://open.tiktokapis.com/v2/oauth/token/");
        expect(init?.method).toBe("POST");
        const bodyParams = new URLSearchParams(init?.body as string);
        expect(bodyParams.get("grant_type")).toBe("refresh_token");
        expect(bodyParams.get("refresh_token")).toBe("rft.existing_token");
        expect(bodyParams.get("client_key")).toBe("test-tiktok-client-key");
        expect(bodyParams.get("client_secret")).toBe("test-tiktok-client-secret");

        return Promise.resolve(
          new Response(JSON.stringify(recordedBody(tiktokRecording.refresh.success, 0)), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        );
      });

      global.fetch = fetchMock;

      const before = Date.now();
      const refreshed = await tiktokAdapter.refresh({
        accessToken: "act.old_token",
        refreshToken: "rft.existing_token",
      });
      const after = Date.now();

      expect(refreshed.accessToken).toBe("act.refreshed_access_token");
      expect(refreshed.refreshToken).toBe("rft.new_rotated_refresh_token");
      expect(refreshed.expiresAt).toBeInstanceOf(Date);
      const expiresAtMs = refreshed.expiresAt!.getTime();
      expect(expiresAtMs).toBeGreaterThanOrEqual(before + 86400 * 1000);
      expect(expiresAtMs).toBeLessThanOrEqual(after + 86400 * 1000);
    });

    it("preserves existing refreshToken if response omits new refresh_token", async () => {
      const mockRefreshResponse = {
        access_token: "act.new_access_token",
      };

      global.fetch = vi.fn().mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify(mockRefreshResponse), { status: 200 })
        )
      );

      const refreshed = await tiktokAdapter.refresh({
        accessToken: "act.old",
        refreshToken: "rft.preserve_me",
      });

      expect(refreshed.accessToken).toBe("act.new_access_token");
      expect(refreshed.refreshToken).toBe("rft.preserve_me");
      expect(refreshed.expiresAt).toBeUndefined();
    });

    it("throws AdapterError REVOKED when token endpoint returns invalid_grant", async () => {
      global.fetch = vi.fn().mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify(recordedBody(errorRecording(tiktokRecording, "refresh", "revoked"), 0)),
            {
              status: 400,
              headers: { "Content-Type": "application/json" },
            }
          )
        )
      );

      try {
        await tiktokAdapter.refresh({
          accessToken: "act.old",
          refreshToken: "rft.revoked",
        });
        expect.unreachable("should have thrown");
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(AdapterError);
        const adapterError = err as AdapterError;
        expect(adapterError.platform).toBe("tiktok");
        expect(adapterError.code).toBe("REVOKED");
        expect(adapterError.message).toContain("token revoked or expired (invalid_grant)");
      }
    });

    it("throws AdapterError UPSTREAM_ERROR on 500 error response", async () => {
      global.fetch = vi.fn().mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify(recordedBody(errorRecording(tiktokRecording, "refresh", "upstream"), 0)),
            {
              status: 500,
              statusText: "Server Error",
            }
          )
        )
      );

      try {
        await tiktokAdapter.refresh({
          accessToken: "act.old",
          refreshToken: "rft.valid",
        });
        expect.unreachable("should have thrown");
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(AdapterError);
        const adapterError = err as AdapterError;
        expect(adapterError.platform).toBe("tiktok");
        expect(adapterError.code).toBe("UPSTREAM_ERROR");
        expect(adapterError.message).toContain("failed to refresh token");
      }
    });

    it("throws AdapterError UPSTREAM_ERROR when refresh response lacks access_token", async () => {
      global.fetch = vi.fn().mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify({ expires_in: 86400 }), {
            status: 200,
          })
        )
      );

      try {
        await tiktokAdapter.refresh({
          accessToken: "act.old",
          refreshToken: "rft.valid",
        });
        expect.unreachable("should have thrown");
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(AdapterError);
        const adapterError = err as AdapterError;
        expect(adapterError.code).toBe("UPSTREAM_ERROR");
        expect(adapterError.message).toContain("malformed token refresh response");
      }
    });
  });

  describe("fetchProfile", () => {
    const mockAccount: ConnectedAccount = {
      id: "acc_123",
      platform: "tiktok",
      externalId: "open_id_xyz",
      tokens: {
        accessToken: "act.valid_access_token",
        refreshToken: "rft.valid_refresh_token",
      },
    };

    it("fetches and returns a complete ProfileSnapshot with numeric counts", async () => {
      const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        expect(url).toBe(
          "https://open.tiktokapis.com/v2/user/info/?fields=open_id%2Cunion_id%2Cavatar_url%2Cdisplay_name%2Cfollower_count%2Cfollowing_count%2Clikes_count%2Cvideo_count"
        );
        expect((init?.headers as Record<string, string>)?.[
          "Authorization"
        ]).toBe("Bearer act.valid_access_token");

        return Promise.resolve(
          new Response(
            JSON.stringify(recordedBody(tiktokRecording.fetchProfile.success, 0)),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          )
        );
      });

      global.fetch = fetchMock;

      const profile = await tiktokAdapter.fetchProfile(mockAccount);

      expect(profile.handle).toBe("Super Creator");
      expect(profile.avatarUrl).toBe("https://p16-sign.tiktokcdn-us.com/avatar.jpg");
      expect(profile.audienceCount).toBe(15420);
      expect(profile.extras).toEqual({
        unionId: "union_id_123",
        followingCount: 310,
        likesCount: 245000,
        videoCount: 88,
      });
    });

    it("falls back to open_id for handle and defaults missing counts to 0", async () => {
      const mockUserInfoResponse = {
        data: {
          user: {
            open_id: "open_id_xyz",
          },
        },
        error: { code: "ok" },
      };

      global.fetch = vi.fn().mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify(mockUserInfoResponse), { status: 200 })
        )
      );

      const profile = await tiktokAdapter.fetchProfile(mockAccount);

      expect(profile.handle).toBe("open_id_xyz");
      expect(profile.avatarUrl).toBeUndefined();
      expect(profile.audienceCount).toBe(0);
      expect(profile.extras).toEqual({
        followingCount: 0,
        likesCount: 0,
        videoCount: 0,
      });
    });

    it("throws AdapterError UNAUTHORIZED on 401 HTTP response", async () => {
      global.fetch = vi.fn().mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify(recordedBody(errorRecording(tiktokRecording, "fetchProfile", "unauthorized"), 0)),
            {
              status: 401,
              statusText: "Unauthorized",
            }
          )
        )
      );

      try {
        await tiktokAdapter.fetchProfile(mockAccount);
        expect.unreachable("should have thrown");
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(AdapterError);
        const adapterError = err as AdapterError;
        expect(adapterError.platform).toBe("tiktok");
        expect(adapterError.code).toBe("UNAUTHORIZED");
        expect(adapterError.message).toContain("access token expired or invalid");
      }
    });

    it("throws AdapterError UNAUTHORIZED when error code is access_token_invalid", async () => {
      global.fetch = vi.fn().mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify(recordedBody(errorRecording(tiktokRecording, "fetchProfile", "unauthorizedBody"), 0)),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          )
        )
      );

      try {
        await tiktokAdapter.fetchProfile(mockAccount);
        expect.unreachable("should have thrown");
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(AdapterError);
        const adapterError = err as AdapterError;
        expect(adapterError.platform).toBe("tiktok");
        expect(adapterError.code).toBe("UNAUTHORIZED");
        expect(adapterError.message).toContain("The access token is invalid or has expired");
      }
    });

    it("throws AdapterError RATE_LIMITED on 429 HTTP response", async () => {
      global.fetch = vi.fn().mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify(recordedBody(errorRecording(tiktokRecording, "fetchProfile", "rateLimited"), 0)),
            {
              status: 429,
              statusText: "Too Many Requests",
            }
          )
        )
      );

      try {
        await tiktokAdapter.fetchProfile(mockAccount);
        expect.unreachable("should have thrown");
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(AdapterError);
        const adapterError = err as AdapterError;
        expect(adapterError.platform).toBe("tiktok");
        expect(adapterError.code).toBe("RATE_LIMITED");
        expect(adapterError.message).toContain("rate limit exceeded");
      }
    });

    it("throws AdapterError RATE_LIMITED when error code is rate_limit_exceeded", async () => {
      global.fetch = vi.fn().mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify(recordedBody(errorRecording(tiktokRecording, "fetchProfile", "rateLimitedBody"), 0)),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          )
        )
      );

      try {
        await tiktokAdapter.fetchProfile(mockAccount);
        expect.unreachable("should have thrown");
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(AdapterError);
        const adapterError = err as AdapterError;
        expect(adapterError.platform).toBe("tiktok");
        expect(adapterError.code).toBe("RATE_LIMITED");
      }
    });

    it("throws AdapterError NOT_FOUND when user object is missing", async () => {
      global.fetch = vi.fn().mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify(recordedBody(errorRecording(tiktokRecording, "fetchProfile", "notFound"), 0)),
            { status: 200 }
          )
        )
      );

      try {
        await tiktokAdapter.fetchProfile(mockAccount);
        expect.unreachable("should have thrown");
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(AdapterError);
        const adapterError = err as AdapterError;
        expect(adapterError.platform).toBe("tiktok");
        expect(adapterError.code).toBe("NOT_FOUND");
        expect(adapterError.message).toContain("No user profile found");
      }
    });

    it("throws AdapterError UPSTREAM_ERROR on other error envelope codes", async () => {
      const mockErrorResponse = {
        data: {},
        error: {
          code: "scope_not_authorized",
          message: "User has not authorized this scope",
        },
      };

      global.fetch = vi.fn().mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify(mockErrorResponse), { status: 200 })
        )
      );

      try {
        await tiktokAdapter.fetchProfile(mockAccount);
        expect.unreachable("should have thrown");
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(AdapterError);
        const adapterError = err as AdapterError;
        expect(adapterError.platform).toBe("tiktok");
        expect(adapterError.code).toBe("UPSTREAM_ERROR");
        expect(adapterError.message).toContain("User has not authorized this scope");
      }
    });

    it("throws AdapterError UPSTREAM_ERROR on HTTP 500 error", async () => {
      global.fetch = vi.fn().mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify(recordedBody(errorRecording(tiktokRecording, "fetchProfile", "upstream"), 0)),
            {
              status: 500,
              statusText: "Internal Server Error",
            }
          )
        )
      );

      try {
        await tiktokAdapter.fetchProfile(mockAccount);
        expect.unreachable("should have thrown");
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(AdapterError);
        const adapterError = err as AdapterError;
        expect(adapterError.code).toBe("UPSTREAM_ERROR");
        expect(adapterError.message).toContain("failed to fetch user info");
      }
    });
  });
});
