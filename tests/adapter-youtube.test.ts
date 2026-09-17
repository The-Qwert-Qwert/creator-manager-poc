import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { YouTubeAdapter, youtubeAdapter } from "@/lib/adapters/youtube";
import { AdapterError, type ConnectedAccount } from "@/lib/adapters/types";

describe("YouTubeAdapter", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "test-client-id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "test-client-secret");
    vi.stubEnv(
      "GOOGLE_REDIRECT_URI",
      "http://localhost:3000/api/auth/youtube/callback"
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("has platform property set to youtube", () => {
    expect(youtubeAdapter.platform).toBe("youtube");
    expect(new YouTubeAdapter().platform).toBe("youtube");
  });

  describe("authUrl", () => {
    it("builds the correct Google OAuth 2.0 authorization URL", () => {
      const state = "random-csrf-state-123";
      const urlString = youtubeAdapter.authUrl(state);
      const url = new URL(urlString);

      expect(url.origin).toBe("https://accounts.google.com");
      expect(url.pathname).toBe("/o/oauth2/v2/auth");
      expect(url.searchParams.get("client_id")).toBe("test-client-id");
      expect(url.searchParams.get("redirect_uri")).toBe(
        "http://localhost:3000/api/auth/youtube/callback"
      );
      expect(url.searchParams.get("response_type")).toBe("code");
      expect(url.searchParams.get("scope")).toBe(
        "https://www.googleapis.com/auth/youtube.readonly"
      );
      expect(url.searchParams.get("access_type")).toBe("offline");
      expect(url.searchParams.get("prompt")).toBe("consent");
      expect(url.searchParams.get("state")).toBe(state);
    });
  });

  describe("exchangeCode", () => {
    it("exchanges authorization code for tokens and channel info", async () => {
      const mockTokenResponse = {
        access_token: "ya29.mock_access_token",
        expires_in: 3600,
        token_type: "Bearer",
        scope: "https://www.googleapis.com/auth/youtube.readonly",
        refresh_token: "1//mock_refresh_token",
      };

      const mockChannelResponse = {
        kind: "youtube#channelListResponse",
        items: [
          {
            id: "UC_channel_123",
            snippet: {
              title: "Test Channel",
              customUrl: "@testchannel",
              thumbnails: {
                high: { url: "https://yt3.ggpht.com/high.jpg" },
              },
            },
            statistics: {
              viewCount: "1000",
              subscriberCount: "500",
              videoCount: "10",
              hiddenSubscriberCount: false,
            },
          },
        ],
      };

      const fetchMock = vi.fn().mockImplementation((url: string) => {
        if (url === "https://oauth2.googleapis.com/token") {
          return Promise.resolve(
            new Response(JSON.stringify(mockTokenResponse), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            })
          );
        }
        if (url.startsWith("https://www.googleapis.com/youtube/v3/channels")) {
          return Promise.resolve(
            new Response(JSON.stringify(mockChannelResponse), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            })
          );
        }
        return Promise.reject(new Error(`Unhandled URL: ${url}`));
      });
      global.fetch = fetchMock;

      const result = await youtubeAdapter.exchangeCode("auth-code-xyz");

      expect(fetchMock).toHaveBeenCalledTimes(2);

      // Verify token request
      const [tokenUrl, tokenOptions] = fetchMock.mock.calls[0] as [
        string,
        RequestInit & { headers: Record<string, string>; body: string },
      ];
      expect(tokenUrl).toBe("https://oauth2.googleapis.com/token");
      expect(tokenOptions.method).toBe("POST");
      expect(tokenOptions.headers["Content-Type"]).toBe(
        "application/x-www-form-urlencoded"
      );
      const tokenBody = new URLSearchParams(tokenOptions.body);
      expect(tokenBody.get("code")).toBe("auth-code-xyz");
      expect(tokenBody.get("client_id")).toBe("test-client-id");
      expect(tokenBody.get("client_secret")).toBe("test-client-secret");
      expect(tokenBody.get("redirect_uri")).toBe(
        "http://localhost:3000/api/auth/youtube/callback"
      );
      expect(tokenBody.get("grant_type")).toBe("authorization_code");

      // Verify channel request
      const [channelUrl, channelOptions] = fetchMock.mock.calls[1] as [
        string,
        RequestInit & { headers: Record<string, string> },
      ];
      expect(channelUrl).toContain(
        "https://www.googleapis.com/youtube/v3/channels"
      );
      expect(channelOptions.headers.Authorization).toBe(
        "Bearer ya29.mock_access_token"
      );

      // Verify result
      expect(result.tokens.accessToken).toBe("ya29.mock_access_token");
      expect(result.tokens.refreshToken).toBe("1//mock_refresh_token");
      expect(result.tokens.expiresAt).toBeInstanceOf(Date);
      expect(result.externalId).toBe("UC_channel_123");
      expect(result.handle).toBe("@testchannel");
    });

    it("falls back to channel title if customUrl is absent", async () => {
      const mockTokenResponse = {
        access_token: "ya29.mock_access_token",
        expires_in: 3600,
      };

      const mockChannelResponse = {
        items: [
          {
            id: "UC_fallback_id",
            snippet: {
              title: "Fallback Title",
            },
          },
        ],
      };

      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url === "https://oauth2.googleapis.com/token") {
          return Promise.resolve(
            new Response(JSON.stringify(mockTokenResponse), { status: 200 })
          );
        }
        return Promise.resolve(
          new Response(JSON.stringify(mockChannelResponse), { status: 200 })
        );
      });

      const result = await youtubeAdapter.exchangeCode("code");
      expect(result.handle).toBe("Fallback Title");
      expect(result.externalId).toBe("UC_fallback_id");
    });

    it("throws AdapterError UPSTREAM_ERROR when token exchange fails", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: "invalid_grant",
            error_description: "Code expired",
          }),
          { status: 400, statusText: "Bad Request" }
        )
      );

      try {
        await youtubeAdapter.exchangeCode("bad-code");
        expect.unreachable("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(AdapterError);
        const err = e as AdapterError;
        expect(err.platform).toBe("youtube");
        expect(err.code).toBe("UPSTREAM_ERROR");
        expect(err.message).toContain("Code expired");
      }
    });

    it("throws AdapterError NOT_FOUND when no YouTube channel is found for the account", async () => {
      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url === "https://oauth2.googleapis.com/token") {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                access_token: "ya29.token",
                expires_in: 3600,
              }),
              { status: 200 }
            )
          );
        }
        return Promise.resolve(
          new Response(JSON.stringify({ items: [] }), { status: 200 })
        );
      });

      try {
        await youtubeAdapter.exchangeCode("valid-code");
        expect.unreachable("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(AdapterError);
        const err = e as AdapterError;
        expect(err.platform).toBe("youtube");
        expect(err.code).toBe("NOT_FOUND");
        expect(err.message).toContain(
          "No YouTube channel found for this Google account"
        );
      }
    });
  });

  describe("refresh", () => {
    it("throws AdapterError REVOKED if refreshToken is missing", async () => {
      try {
        await youtubeAdapter.refresh({ accessToken: "access-only" });
        expect.unreachable("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(AdapterError);
        const err = e as AdapterError;
        expect(err.platform).toBe("youtube");
        expect(err.code).toBe("REVOKED");
        expect(err.message).toContain("refresh token missing");
      }
    });

    it("refreshes access token and preserves existing refreshToken if not returned", async () => {
      const mockTokenResponse = {
        access_token: "ya29.new_access_token",
        expires_in: 3600,
        token_type: "Bearer",
      };

      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(mockTokenResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );
      global.fetch = fetchMock;

      const refreshed = await youtubeAdapter.refresh({
        accessToken: "old-token",
        refreshToken: "original-refresh-token",
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [tokenUrl, tokenOptions] = fetchMock.mock.calls[0] as [
        string,
        RequestInit & { body: string },
      ];
      expect(tokenUrl).toBe("https://oauth2.googleapis.com/token");
      const tokenBody = new URLSearchParams(tokenOptions.body);
      expect(tokenBody.get("grant_type")).toBe("refresh_token");
      expect(tokenBody.get("refresh_token")).toBe("original-refresh-token");
      expect(tokenBody.get("client_id")).toBe("test-client-id");
      expect(tokenBody.get("client_secret")).toBe("test-client-secret");

      expect(refreshed.accessToken).toBe("ya29.new_access_token");
      expect(refreshed.refreshToken).toBe("original-refresh-token");
      expect(refreshed.expiresAt).toBeInstanceOf(Date);
    });

    it("updates refreshToken if Google returns a new one", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            access_token: "ya29.new_token",
            expires_in: 3600,
            refresh_token: "brand-new-refresh-token",
          }),
          { status: 200 }
        )
      );

      const refreshed = await youtubeAdapter.refresh({
        accessToken: "old",
        refreshToken: "old-refresh",
      });

      expect(refreshed.refreshToken).toBe("brand-new-refresh-token");
    });

    it("throws AdapterError REVOKED when Google returns invalid_grant", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: "invalid_grant",
            error_description: "Token has been expired or revoked.",
          }),
          { status: 400 }
        )
      );

      try {
        await youtubeAdapter.refresh({
          accessToken: "old",
          refreshToken: "revoked-refresh",
        });
        expect.unreachable("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(AdapterError);
        const err = e as AdapterError;
        expect(err.platform).toBe("youtube");
        expect(err.code).toBe("REVOKED");
        expect(err.message).toContain(
          "token revoked or expired (invalid_grant)"
        );
      }
    });

    it("throws AdapterError UPSTREAM_ERROR when refresh fails with another error", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: "server_error",
            error_description: "Internal error",
          }),
          { status: 500, statusText: "Internal Server Error" }
        )
      );

      try {
        await youtubeAdapter.refresh({
          accessToken: "old",
          refreshToken: "refresh",
        });
        expect.unreachable("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(AdapterError);
        const err = e as AdapterError;
        expect(err.platform).toBe("youtube");
        expect(err.code).toBe("UPSTREAM_ERROR");
        expect(err.message).toContain("Internal error");
      }
    });
  });

  describe("fetchProfile", () => {
    const mockAccount: ConnectedAccount = {
      id: "acc-123",
      platform: "youtube",
      externalId: "UC_channel_123",
      tokens: {
        accessToken: "ya29.valid_access_token",
      },
    };

    it("fetches and parses channel profile snapshot successfully", async () => {
      const mockChannelResponse = {
        kind: "youtube#channelListResponse",
        items: [
          {
            id: "UC_channel_123",
            snippet: {
              title: "Creative Tech",
              customUrl: "@creativetech",
              thumbnails: {
                default: { url: "https://yt3.ggpht.com/default.jpg" },
                medium: { url: "https://yt3.ggpht.com/medium.jpg" },
                high: { url: "https://yt3.ggpht.com/high.jpg" },
              },
            },
            statistics: {
              viewCount: "156320",
              subscriberCount: "873",
              hiddenSubscriberCount: false,
              videoCount: "13",
            },
          },
        ],
      };

      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(mockChannelResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );
      global.fetch = fetchMock;

      const profile = await youtubeAdapter.fetchProfile(mockAccount);

      expect(fetchMock).toHaveBeenCalledWith(
        "https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true",
        {
          headers: {
            Authorization: "Bearer ya29.valid_access_token",
          },
        }
      );

      expect(profile.handle).toBe("@creativetech");
      expect(profile.avatarUrl).toBe("https://yt3.ggpht.com/high.jpg");
      expect(profile.audienceCount).toBe(873);
      expect(profile.extras).toEqual({
        videoCount: 13,
        viewCount: 156320,
        hiddenSubscriberCount: false,
      });
    });

    it("falls back to medium and default thumbnails if high is absent", async () => {
      const mockChannelResponse = {
        items: [
          {
            id: "UC_channel_123",
            snippet: {
              title: "Creative Tech",
              thumbnails: {
                medium: { url: "https://yt3.ggpht.com/medium.jpg" },
                default: { url: "https://yt3.ggpht.com/default.jpg" },
              },
            },
            statistics: {
              subscriberCount: "100",
              videoCount: "2",
              viewCount: "50",
            },
          },
        ],
      };

      global.fetch = vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify(mockChannelResponse), { status: 200 })
        );

      const profile = await youtubeAdapter.fetchProfile(mockAccount);
      expect(profile.avatarUrl).toBe("https://yt3.ggpht.com/medium.jpg");
      expect(profile.handle).toBe("Creative Tech");
    });

    it("returns audienceCount 0 when hiddenSubscriberCount is true", async () => {
      const mockChannelResponse = {
        items: [
          {
            id: "UC_channel_123",
            snippet: {
              title: "Hidden Channel",
            },
            statistics: {
              viewCount: "5000",
              subscriberCount: "9999",
              hiddenSubscriberCount: true,
              videoCount: "5",
            },
          },
        ],
      };

      global.fetch = vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify(mockChannelResponse), { status: 200 })
        );

      const profile = await youtubeAdapter.fetchProfile(mockAccount);
      expect(profile.audienceCount).toBe(0);
      expect(profile.extras.hiddenSubscriberCount).toBe(true);
    });

    it("throws AdapterError UNAUTHORIZED on 401 response", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { code: 401, message: "Request had invalid credentials." },
          }),
          { status: 401, statusText: "Unauthorized" }
        )
      );

      try {
        await youtubeAdapter.fetchProfile(mockAccount);
        expect.unreachable("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(AdapterError);
        const err = e as AdapterError;
        expect(err.platform).toBe("youtube");
        expect(err.code).toBe("UNAUTHORIZED");
        expect(err.message).toContain("token expired");
      }
    });

    it("throws AdapterError RATE_LIMITED on 403 quotaExceeded response", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: 403,
              message: "Quota exceeded",
              errors: [{ reason: "quotaExceeded", message: "Quota exceeded" }],
            },
          }),
          { status: 403, statusText: "Forbidden" }
        )
      );

      try {
        await youtubeAdapter.fetchProfile(mockAccount);
        expect.unreachable("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(AdapterError);
        const err = e as AdapterError;
        expect(err.platform).toBe("youtube");
        expect(err.code).toBe("RATE_LIMITED");
        expect(err.message).toContain("Quota exceeded");
      }
    });

    it("throws AdapterError RATE_LIMITED on 429 response", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        new Response("Too Many Requests", {
          status: 429,
          statusText: "Too Many Requests",
        })
      );

      try {
        await youtubeAdapter.fetchProfile(mockAccount);
        expect.unreachable("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(AdapterError);
        const err = e as AdapterError;
        expect(err.platform).toBe("youtube");
        expect(err.code).toBe("RATE_LIMITED");
        expect(err.message).toContain("quota exceeded");
      }
    });

    it("throws AdapterError UPSTREAM_ERROR when API returns non-ok response", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        new Response("Server Error", {
          status: 500,
          statusText: "Internal Server Error",
        })
      );

      try {
        await youtubeAdapter.fetchProfile(mockAccount);
        expect.unreachable("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(AdapterError);
        const err = e as AdapterError;
        expect(err.platform).toBe("youtube");
        expect(err.code).toBe("UPSTREAM_ERROR");
        expect(err.message).toContain("Internal Server Error");
      }
    });

    it("throws AdapterError NOT_FOUND when channel items array is empty", async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ items: [] }), { status: 200 })
        );

      try {
        await youtubeAdapter.fetchProfile(mockAccount);
        expect.unreachable("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(AdapterError);
        const err = e as AdapterError;
        expect(err.platform).toBe("youtube");
        expect(err.code).toBe("NOT_FOUND");
        expect(err.message).toContain(
          "No YouTube channel found for this Google account"
        );
      }
    });
  });
});

