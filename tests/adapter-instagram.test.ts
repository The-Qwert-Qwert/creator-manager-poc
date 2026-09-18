import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  InstagramAdapter,
  instagramAdapter,
} from "@/lib/adapters/instagram";
import { AdapterError, type ConnectedAccount } from "@/lib/adapters/types";
import { errorRecording, instagramRecording, recordedBody } from "./fixtures";

describe("InstagramAdapter", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.stubEnv("META_IG_CLIENT_ID", "test-ig-client-id");
    vi.stubEnv("META_IG_CLIENT_SECRET", "test-ig-client-secret");
    vi.stubEnv(
      "META_IG_REDIRECT_URI",
      "http://localhost:3000/api/auth/instagram/callback"
    );
    vi.stubEnv("META_GRAPH_VERSION", "v21.0");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("has platform property set to instagram", () => {
    expect(instagramAdapter.platform).toBe("instagram");
    expect(new InstagramAdapter().platform).toBe("instagram");
  });

  describe("authUrl", () => {
    it("builds the correct Instagram OAuth authorization URL", () => {
      const state = "csrf-state-abc-123";
      const urlString = instagramAdapter.authUrl(state);
      const url = new URL(urlString);

      expect(url.origin).toBe("https://api.instagram.com");
      expect(url.pathname).toBe("/oauth/authorize");
      expect(url.searchParams.get("client_id")).toBe("test-ig-client-id");
      expect(url.searchParams.get("redirect_uri")).toBe(
        "http://localhost:3000/api/auth/instagram/callback"
      );
      expect(url.searchParams.get("response_type")).toBe("code");
      expect(url.searchParams.get("scope")).toBe("instagram_business_basic");
      expect(url.searchParams.get("state")).toBe(state);
    });
  });

  describe("exchangeCode", () => {
    it("strips trailing #_ and completes short -> long -> profile exchange", async () => {
      const exchangeResponses = instagramRecording.exchangeCode.success;

      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => recordedBody(exchangeResponses, 0),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => recordedBody(exchangeResponses, 1),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => recordedBody(exchangeResponses, 2),
        });

      global.fetch = fetchMock;

      const result = await instagramAdapter.exchangeCode("raw-auth-code#_");

      // Verify 3 fetch calls were made in order
      expect(fetchMock).toHaveBeenCalledTimes(3);

      // Call 1: Short token exchange
      const [shortUrl, shortOpts] = fetchMock.mock.calls[0] as [
        string,
        RequestInit & { headers: Record<string, string>; body: string },
      ];
      expect(shortUrl).toBe("https://api.instagram.com/oauth/access_token");
      expect(shortOpts.method).toBe("POST");
      expect(shortOpts.headers["Content-Type"]).toBe(
        "application/x-www-form-urlencoded"
      );
      const shortBody = new URLSearchParams(shortOpts.body);
      expect(shortBody.get("code")).toBe("raw-auth-code"); // sanitized
      expect(shortBody.get("client_id")).toBe("test-ig-client-id");
      expect(shortBody.get("client_secret")).toBe("test-ig-client-secret");
      expect(shortBody.get("grant_type")).toBe("authorization_code");

      // Call 2: Long token exchange
      const [longUrl] = fetchMock.mock.calls[1] as [
        string,
        RequestInit | undefined,
      ];
      const parsedLongUrl = new URL(longUrl);
      expect(parsedLongUrl.origin).toBe("https://graph.instagram.com");
      expect(parsedLongUrl.pathname).toBe("/access_token");
      expect(parsedLongUrl.searchParams.get("grant_type")).toBe(
        "ig_exchange_token"
      );
      expect(parsedLongUrl.searchParams.get("client_secret")).toBe(
        "test-ig-client-secret"
      );
      expect(parsedLongUrl.searchParams.get("access_token")).toBe(
        "short-token-123"
      );

      // Call 3: Profile fetch with Bearer token
      const [profileUrl, profileOpts] = fetchMock.mock.calls[2] as [
        string,
        RequestInit & { headers: Record<string, string> },
      ];
      const parsedProfileUrl = new URL(profileUrl);
      expect(parsedProfileUrl.origin).toBe("https://graph.instagram.com");
      expect(parsedProfileUrl.pathname).toBe("/v21.0/me");
      expect(parsedProfileUrl.searchParams.get("fields")).toBe(
        "id,username,followers_count,profile_picture_url"
      );
      expect(profileOpts.headers["Authorization"]).toBe("Bearer long-token-456");

      // Result shape
      expect(result.externalId).toBe("17841405793187218");
      expect(result.handle).toBe("testcreator");
      expect(result.tokens.accessToken).toBe("long-token-456");
      expect(result.tokens.refreshToken).toBeUndefined();
      expect(result.tokens.expiresAt).toBeInstanceOf(Date);
      expect(result.tokens.expiresAt!.getTime()).toBeGreaterThan(Date.now());
    });

    it("throws UPSTREAM_ERROR if short-lived token exchange fails", async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: "Bad Request",
        json: async () =>
          recordedBody(errorRecording(instagramRecording, "exchangeCode", "upstream"), 0),
      });

      try {
        await instagramAdapter.exchangeCode("invalid-code");
        expect.unreachable("should have thrown");
      } catch (err) {
        const error = err as AdapterError;
        expect(error.platform).toBe("instagram");
        expect(error.code).toBe("UPSTREAM_ERROR");
        expect(error.message).toContain("Invalid authorization code");
      }
    });

    it("throws UPSTREAM_ERROR if short-lived token response is missing access_token", async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ user_id: 12345 }),
      });

      try {
        await instagramAdapter.exchangeCode("valid-code");
        expect.unreachable("should have thrown");
      } catch (err) {
        const error = err as AdapterError;
        expect(error.platform).toBe("instagram");
        expect(error.code).toBe("UPSTREAM_ERROR");
      }
    });

    it("throws UPSTREAM_ERROR if long-lived token exchange fails", async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ access_token: "short-token", user_id: 12345 }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 400,
          statusText: "Bad Request",
          json: async () => ({
            error: { message: "Invalid OAuth access token signature" },
          }),
        });

      try {
        await instagramAdapter.exchangeCode("valid-code");
        expect.unreachable("should have thrown");
      } catch (err) {
        const error = err as AdapterError;
        expect(error.platform).toBe("instagram");
        expect(error.code).toBe("UPSTREAM_ERROR");
        expect(error.message).toContain("Invalid OAuth access token signature");
      }
    });
  });

  describe("refresh", () => {
    it("throws REVOKED if accessToken is missing", async () => {
      try {
        await instagramAdapter.refresh({ accessToken: "" });
        expect.unreachable("should have thrown");
      } catch (err) {
        const error = err as AdapterError;
        expect(error.platform).toBe("instagram");
        expect(error.code).toBe("REVOKED");
      }
    });

    it("successfully refreshes a long-lived access token", async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => recordedBody(instagramRecording.refresh.success, 0),
      });
      global.fetch = fetchMock;

      const refreshed = await instagramAdapter.refresh({
        accessToken: "current-long-token",
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [calledUrl] = fetchMock.mock.calls[0] as [
        string,
        RequestInit | undefined,
      ];
      const parsedUrl = new URL(calledUrl);
      expect(parsedUrl.origin).toBe("https://graph.instagram.com");
      expect(parsedUrl.pathname).toBe("/refresh_access_token");
      expect(parsedUrl.searchParams.get("grant_type")).toBe("ig_refresh_token");
      expect(parsedUrl.searchParams.get("access_token")).toBe(
        "current-long-token"
      );

      expect(refreshed.accessToken).toBe("refreshed-long-token-789");
      expect(refreshed.refreshToken).toBeUndefined();
      expect(refreshed.expiresAt).toBeInstanceOf(Date);
    });

    it("throws REVOKED when token is invalidated (subcode 460)", async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: "Bad Request",
        json: async () => ({
          error: {
            message: "Error validating access token: Session invalidated",
            type: "OAuthException",
            code: 190,
            error_subcode: 460,
          },
        }),
      });

      try {
        await instagramAdapter.refresh({ accessToken: "expired-token" });
        expect.unreachable("should have thrown");
      } catch (err) {
        const error = err as AdapterError;
        expect(error.platform).toBe("instagram");
        expect(error.code).toBe("REVOKED");
      }
    });

    it("throws REVOKED when token has expired (subcode 463)", async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: "Bad Request",
        json: async () => recordedBody(errorRecording(instagramRecording, "refresh", "revoked"), 0),
      });

      try {
        await instagramAdapter.refresh({ accessToken: "expired-token" });
        expect.unreachable("should have thrown");
      } catch (err) {
        const error = err as AdapterError;
        expect(error.platform).toBe("instagram");
        expect(error.code).toBe("REVOKED");
      }
    });

    it("throws REVOKED when token is invalid or logged out (subcode 467)", async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: "Bad Request",
        json: async () => ({
          error: {
            message: "Error validating access token: Token revoked",
            type: "OAuthException",
            code: 190,
            error_subcode: 467,
          },
        }),
      });

      try {
        await instagramAdapter.refresh({ accessToken: "revoked-token" });
        expect.unreachable("should have thrown");
      } catch (err) {
        const error = err as AdapterError;
        expect(error.platform).toBe("instagram");
        expect(error.code).toBe("REVOKED");
      }
    });

    it("throws UPSTREAM_ERROR when refresh is attempted < 24h old (code 190 without terminal subcode)", async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: "Bad Request",
        json: async () => recordedBody(errorRecording(instagramRecording, "refresh", "upstream"), 0),
      });

      try {
        await instagramAdapter.refresh({ accessToken: "too-early-token" });
        expect.unreachable("should have thrown");
      } catch (err) {
        const error = err as AdapterError;
        expect(error.platform).toBe("instagram");
        expect(error.code).toBe("UPSTREAM_ERROR");
      }
    });
  });

  describe("fetchProfile", () => {
    const mockAccount: ConnectedAccount = {
      id: "acc-123",
      platform: "instagram",
      externalId: "17841405793187218",
      tokens: {
        accessToken: "valid-long-token",
      },
    };

    it("returns ProfileSnapshot with mapped fields and extras", async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => recordedBody(instagramRecording.fetchProfile.success, 0),
      });
      global.fetch = fetchMock;

      const profile = await instagramAdapter.fetchProfile(mockAccount);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, opts] = fetchMock.mock.calls[0] as [
        string,
        RequestInit & { headers: Record<string, string> },
      ];
      expect(url).toBe(
        "https://graph.instagram.com/v21.0/me?fields=id%2Cusername%2Cfollowers_count%2Cprofile_picture_url"
      );
      expect(opts.headers["Authorization"]).toBe("Bearer valid-long-token");

      expect(profile.handle).toBe("my_brand");
      expect(profile.avatarUrl).toBe("https://scontent.cdninstagram.com/pic.jpg");
      expect(profile.audienceCount).toBe(54321);
      expect(profile.extras).toEqual({
        igUserId: "17841405793187218",
      });
    });

    it("handles missing profile_picture_url gracefully", async () => {
      const mockProfileResponse = {
        id: "17841405793187218",
        username: "no_avatar_user",
        followers_count: 100,
      };

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockProfileResponse,
      });

      const profile = await instagramAdapter.fetchProfile(mockAccount);

      expect(profile.handle).toBe("no_avatar_user");
      expect(profile.avatarUrl).toBeUndefined();
      expect(profile.audienceCount).toBe(100);
    });

    it("throws UNAUTHORIZED on HTTP 401", async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        json: async () =>
          recordedBody(errorRecording(instagramRecording, "fetchProfile", "unauthorized"), 0),
      });

      try {
        await instagramAdapter.fetchProfile(mockAccount);
        expect.unreachable("should have thrown");
      } catch (err) {
        const error = err as AdapterError;
        expect(error.platform).toBe("instagram");
        expect(error.code).toBe("UNAUTHORIZED");
      }
    });

    it("throws RATE_LIMITED on HTTP 429", async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
        json: async () =>
          recordedBody(errorRecording(instagramRecording, "fetchProfile", "rateLimited"), 0),
      });

      try {
        await instagramAdapter.fetchProfile(mockAccount);
        expect.unreachable("should have thrown");
      } catch (err) {
        const error = err as AdapterError;
        expect(error.platform).toBe("instagram");
        expect(error.code).toBe("RATE_LIMITED");
      }
    });

    it("throws NOT_FOUND when username or id is missing from profile response", async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () =>
          recordedBody(errorRecording(instagramRecording, "fetchProfile", "notFound"), 0), // missing username
      });

      try {
        await instagramAdapter.fetchProfile(mockAccount);
        expect.unreachable("should have thrown");
      } catch (err) {
        const error = err as AdapterError;
        expect(error.platform).toBe("instagram");
        expect(error.code).toBe("NOT_FOUND");
      }
    });

    it("throws UPSTREAM_ERROR on HTTP 500 or general server error", async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        json: async () =>
          recordedBody(errorRecording(instagramRecording, "fetchProfile", "upstream"), 0),
      });

      try {
        await instagramAdapter.fetchProfile(mockAccount);
        expect.unreachable("should have thrown");
      } catch (err) {
        const error = err as AdapterError;
        expect(error.platform).toBe("instagram");
        expect(error.code).toBe("UPSTREAM_ERROR");
        expect(error.message).toContain("Internal Graph API error");
      }
    });
  });
});
