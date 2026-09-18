import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FacebookAdapter, facebookAdapter } from "@/lib/adapters/facebook";
import { AdapterError, type ConnectedAccount } from "@/lib/adapters/types";
import { errorRecording, facebookRecording, recordedBody } from "./fixtures";

describe("FacebookAdapter", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.stubEnv("META_FB_CLIENT_ID", "test-fb-client-id");
    vi.stubEnv("META_FB_CLIENT_SECRET", "test-fb-client-secret");
    vi.stubEnv(
      "META_FB_REDIRECT_URI",
      "http://localhost:3000/api/auth/facebook/callback"
    );
    vi.stubEnv("META_GRAPH_VERSION", "v21.0");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("has platform property set to facebook", () => {
    expect(facebookAdapter.platform).toBe("facebook");
    expect(new FacebookAdapter().platform).toBe("facebook");
  });

  describe("authUrl", () => {
    it("builds correct OAuth URL with default permissions scope", () => {
      const state = "csrf-state-abc";
      const urlString = facebookAdapter.authUrl(state);
      const url = new URL(urlString);

      expect(url.origin).toBe("https://www.facebook.com");
      expect(url.pathname).toBe("/v21.0/dialog/oauth");
      expect(url.searchParams.get("client_id")).toBe("test-fb-client-id");
      expect(url.searchParams.get("redirect_uri")).toBe(
        "http://localhost:3000/api/auth/facebook/callback"
      );
      expect(url.searchParams.get("response_type")).toBe("code");
      expect(url.searchParams.get("state")).toBe(state);
      expect(url.searchParams.get("scope")).toBe(
        "pages_show_list,pages_read_engagement"
      );
      expect(url.searchParams.has("config_id")).toBe(false);
    });

    it("builds correct OAuth URL with config_id and omits scope when META_FB_CONFIG_ID is set", () => {
      vi.stubEnv("META_FB_CONFIG_ID", "1234567890_business_config");
      const state = "csrf-state-business";
      const urlString = facebookAdapter.authUrl(state);
      const url = new URL(urlString);

      expect(url.searchParams.get("config_id")).toBe(
        "1234567890_business_config"
      );
      expect(url.searchParams.has("scope")).toBe(false);
      expect(url.searchParams.get("client_id")).toBe("test-fb-client-id");
      expect(url.searchParams.get("state")).toBe(state);
    });

    it("respects META_GRAPH_VERSION env variable", () => {
      vi.stubEnv("META_GRAPH_VERSION", "v22.0");
      const url = new URL(facebookAdapter.authUrl("state"));
      expect(url.pathname).toBe("/v22.0/dialog/oauth");
    });
  });

  describe("exchangeCode", () => {
    it("executes 3-step token exchange and returns primary page details", async () => {
      const fetchMock = vi.fn().mockImplementation((url: string) => {
        const parsed = new URL(url);

        // Step 1: short-lived user token exchange
        if (
          parsed.origin === "https://graph.facebook.com" &&
          parsed.pathname === "/v21.0/oauth/access_token" &&
          parsed.searchParams.get("code") === "valid-code"
        ) {
          return Promise.resolve(
            new Response(
              JSON.stringify(recordedBody(facebookRecording.exchangeCode.success, 0)),
              { status: 200, headers: { "Content-Type": "application/json" } }
            )
          );
        }

        // Step 2: long-lived user token exchange
        if (
          parsed.origin === "https://graph.facebook.com" &&
          parsed.pathname === "/v21.0/oauth/access_token" &&
          parsed.searchParams.get("grant_type") === "fb_exchange_token" &&
          parsed.searchParams.get("fb_exchange_token") ===
            "short_lived_user_token_123"
        ) {
          return Promise.resolve(
            new Response(
              JSON.stringify(recordedBody(facebookRecording.exchangeCode.success, 1)),
              { status: 200, headers: { "Content-Type": "application/json" } }
            )
          );
        }

        // Step 3: me/accounts page list
        if (
          parsed.origin === "https://graph.facebook.com" &&
          parsed.pathname === "/v21.0/me/accounts" &&
          parsed.searchParams.get("access_token") === "long_lived_user_token_456"
        ) {
          return Promise.resolve(
            new Response(
              JSON.stringify(recordedBody(facebookRecording.exchangeCode.success, 2)),
              { status: 200, headers: { "Content-Type": "application/json" } }
            )
          );
        }

        return Promise.reject(new Error(`Unhandled request URL: ${url}`));
      });

      global.fetch = fetchMock;

      const result = await facebookAdapter.exchangeCode("valid-code");

      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(result).toEqual({
        tokens: {
          accessToken: "permanent_page_access_token_789",
          refreshToken: undefined,
          expiresAt: undefined,
        },
        externalId: "page_12345",
        handle: "Awesome Creator Page",
      });
    });

    it("throws NOT_FOUND when user manages no Facebook Pages", async () => {
      global.fetch = vi.fn().mockImplementation((url: string) => {
        const parsed = new URL(url);
        const notFound = errorRecording(facebookRecording, "exchangeCode", "notFound");

        if (parsed.searchParams.get("code") === "code-no-pages") {
          return Promise.resolve(
            new Response(JSON.stringify(recordedBody(notFound, 0)), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            })
          );
        }

        if (parsed.searchParams.get("grant_type") === "fb_exchange_token") {
          return Promise.resolve(
            new Response(JSON.stringify(recordedBody(notFound, 1)), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            })
          );
        }

        if (parsed.pathname === "/v21.0/me/accounts") {
          return Promise.resolve(
            new Response(JSON.stringify(recordedBody(notFound, 2)), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            })
          );
        }

        return Promise.reject(new Error(`Unhandled: ${url}`));
      });

      await expect(
        facebookAdapter.exchangeCode("code-no-pages")
      ).rejects.toThrowError(
        new AdapterError(
          "facebook",
          "NOT_FOUND",
          "No Facebook Pages found for this account"
        )
      );
    });

    it("throws UPSTREAM_ERROR when step 1 authorization code exchange fails", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify(recordedBody(errorRecording(facebookRecording, "exchangeCode", "upstream"), 0)),
          { status: 400, headers: { "Content-Type": "application/json" } }
        )
      );

      await expect(
        facebookAdapter.exchangeCode("bad-code")
      ).rejects.toThrowError(
        new AdapterError(
          "facebook",
          "UPSTREAM_ERROR",
          "Failed to exchange authorization code: Invalid verification code format."
        )
      );
    });

    it("throws UPSTREAM_ERROR when step 2 long-lived token exchange fails", async () => {
      global.fetch = vi.fn().mockImplementation((url: string) => {
        const parsed = new URL(url);
        if (parsed.searchParams.has("code")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({ access_token: "short_token" }),
              { status: 200, headers: { "Content-Type": "application/json" } }
            )
          );
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              error: {
                message: "Error validating client secret.",
                code: 1,
              },
            }),
            { status: 400, headers: { "Content-Type": "application/json" } }
          )
        );
      });

      await expect(
        facebookAdapter.exchangeCode("code-step2-fail")
      ).rejects.toThrowError(
        new AdapterError(
          "facebook",
          "UPSTREAM_ERROR",
          "Failed to exchange for long-lived user token: Error validating client secret."
        )
      );
    });

    it("throws UPSTREAM_ERROR when step 3 me/accounts query returns an error", async () => {
      global.fetch = vi.fn().mockImplementation((url: string) => {
        const parsed = new URL(url);
        if (parsed.searchParams.has("code")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({ access_token: "short_token" }),
              { status: 200, headers: { "Content-Type": "application/json" } }
            )
          );
        }
        if (parsed.searchParams.get("grant_type") === "fb_exchange_token") {
          return Promise.resolve(
            new Response(
              JSON.stringify({ access_token: "long_token" }),
              { status: 200, headers: { "Content-Type": "application/json" } }
            )
          );
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              error: {
                message: "An active access token must be used to query information about the current user.",
                type: "OAuthException",
                code: 2500,
              },
            }),
            { status: 400, headers: { "Content-Type": "application/json" } }
          )
        );
      });

      await expect(
        facebookAdapter.exchangeCode("code-step3-fail")
      ).rejects.toThrowError(
        new AdapterError(
          "facebook",
          "UPSTREAM_ERROR",
          "Failed to fetch Facebook Pages: An active access token must be used to query information about the current user."
        )
      );
    });

    it("throws UPSTREAM_ERROR when primary page is missing id or access_token", async () => {
      global.fetch = vi.fn().mockImplementation((url: string) => {
        const parsed = new URL(url);
        if (parsed.searchParams.has("code")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({ access_token: "short_token" }),
              { status: 200, headers: { "Content-Type": "application/json" } }
            )
          );
        }
        if (parsed.searchParams.get("grant_type") === "fb_exchange_token") {
          return Promise.resolve(
            new Response(
              JSON.stringify({ access_token: "long_token" }),
              { status: 200, headers: { "Content-Type": "application/json" } }
            )
          );
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              data: [
                {
                  id: "",
                  name: "Incomplete Page",
                  access_token: "",
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          )
        );
      });

      await expect(
        facebookAdapter.exchangeCode("code-malformed-page")
      ).rejects.toThrowError(
        new AdapterError(
          "facebook",
          "UPSTREAM_ERROR",
          "Invalid page data received from Facebook"
        )
      );
    });
  });

  describe("refresh", () => {
    it("always throws REVOKED because Facebook page tokens cannot be refreshed programmatically", async () => {
      await expect(
        facebookAdapter.refresh({ accessToken: "any_token" })
      ).rejects.toThrowError(
        new AdapterError(
          "facebook",
          "REVOKED",
          "Facebook page tokens cannot be refreshed programmatically; re-connect required"
        )
      );
    });
  });

  describe("fetchProfile", () => {
    const mockAccount: ConnectedAccount = {
      id: "acc-1",
      platform: "facebook",
      externalId: "page_12345",
      tokens: {
        accessToken: "valid_page_token",
      },
    };

    it("successfully fetches profile and maps audienceCount from followers_count", async () => {
      global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        expect(url).toBe(
          "https://graph.facebook.com/v21.0/page_12345?fields=id,name,followers_count,fan_count,picture"
        );
        expect(init?.headers).toEqual({
          Authorization: "Bearer valid_page_token",
        });

        return Promise.resolve(
          new Response(
            JSON.stringify(recordedBody(facebookRecording.fetchProfile.success, 0)),
            { status: 200, headers: { "Content-Type": "application/json" } }
          )
        );
      });

      const profile = await facebookAdapter.fetchProfile(mockAccount);

      expect(profile).toEqual({
        handle: "Creator's FB Page",
        avatarUrl: "https://lookaside.fbsbx.com/page-avatar.jpg",
        audienceCount: 8500,
        extras: {
          fanCount: 8200,
          pageId: "page_12345",
        },
      });
    });

    it("falls back to fan_count when followers_count is missing", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            id: "page_12345",
            name: "Classic Page",
            fan_count: 4200,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

      const profile = await facebookAdapter.fetchProfile(mockAccount);

      expect(profile.audienceCount).toBe(4200);
      expect(profile.extras.fanCount).toBe(4200);
      expect(profile.avatarUrl).toBeUndefined();
    });

    it("defaults audienceCount to 0 when both followers_count and fan_count are missing", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            id: "page_12345",
            name: "Brand New Page",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

      const profile = await facebookAdapter.fetchProfile(mockAccount);

      expect(profile.audienceCount).toBe(0);
    });

    it("throws REVOKED when receiving OAuthException code 190 on HTTP 400", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify(recordedBody(errorRecording(facebookRecording, "fetchProfile", "revoked"), 0)),
          { status: 400, headers: { "Content-Type": "application/json" } }
        )
      );

      await expect(
        facebookAdapter.fetchProfile(mockAccount)
      ).rejects.toThrowError(
        new AdapterError(
          "facebook",
          "REVOKED",
          "Error validating access token: Session has expired."
        )
      );
    });

    it("throws REVOKED on HTTP 401 response", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify(recordedBody(errorRecording(facebookRecording, "fetchProfile", "unauthorized"), 0)),
          { status: 401, headers: { "Content-Type": "application/json" } }
        )
      );

      await expect(
        facebookAdapter.fetchProfile(mockAccount)
      ).rejects.toThrowError(
        new AdapterError(
          "facebook",
          "REVOKED",
          "Unauthorized token"
        )
      );
    });

    it("throws REVOKED on HTTP 200 OK containing code 190 error envelope", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              message: "The access token has been revoked.",
              type: "OAuthException",
              code: 190,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

      await expect(
        facebookAdapter.fetchProfile(mockAccount)
      ).rejects.toThrowError(
        new AdapterError(
          "facebook",
          "REVOKED",
          "The access token has been revoked."
        )
      );
    });

    it("throws RATE_LIMITED on HTTP 429", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify(recordedBody(errorRecording(facebookRecording, "fetchProfile", "rateLimited"), 0)),
          { status: 429, statusText: "Too Many Requests", headers: { "Content-Type": "application/json" } }
        )
      );

      await expect(
        facebookAdapter.fetchProfile(mockAccount)
      ).rejects.toThrowError(
        new AdapterError(
          "facebook",
          "RATE_LIMITED",
          "Too Many Requests"
        )
      );
    });

    it.each([4, 17, 32, 613])(
      "throws RATE_LIMITED on throttling error code %i",
      async (code) => {
        global.fetch = vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              error: {
                message: `Throttled with code ${code}`,
                code,
              },
            }),
            { status: 403, headers: { "Content-Type": "application/json" } }
          )
        );

        await expect(
          facebookAdapter.fetchProfile(mockAccount)
        ).rejects.toThrowError(
          new AdapterError(
            "facebook",
            "RATE_LIMITED",
            `Throttled with code ${code}`
          )
        );
      }
    );

    it("throws NOT_FOUND on HTTP 404", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify(recordedBody(errorRecording(facebookRecording, "fetchProfile", "notFound"), 0)),
          { status: 404, statusText: "Not Found", headers: { "Content-Type": "application/json" } }
        )
      );

      await expect(
        facebookAdapter.fetchProfile(mockAccount)
      ).rejects.toThrowError(
        new AdapterError("facebook", "NOT_FOUND", "Not Found")
      );
    });

    it("throws NOT_FOUND when code 100 indicates page object does not exist", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              message: "Unsupported get request. Object with ID 'page_12345' does not exist.",
              type: "GraphMethodException",
              code: 100,
            },
          }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        )
      );

      await expect(
        facebookAdapter.fetchProfile(mockAccount)
      ).rejects.toThrowError(
        new AdapterError(
          "facebook",
          "NOT_FOUND",
          "Unsupported get request. Object with ID 'page_12345' does not exist."
        )
      );
    });

    it("throws UPSTREAM_ERROR on generic HTTP 500 error", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify(recordedBody(errorRecording(facebookRecording, "fetchProfile", "upstream"), 0)),
          { status: 500, statusText: "Internal Server Error", headers: { "Content-Type": "application/json" } }
        )
      );

      await expect(
        facebookAdapter.fetchProfile(mockAccount)
      ).rejects.toThrowError(
        new AdapterError(
          "facebook",
          "UPSTREAM_ERROR",
          "Failed to fetch Facebook Page profile: Internal Server Error"
        )
      );
    });

    it("throws UPSTREAM_ERROR when profile response is missing id", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({}),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

      await expect(
        facebookAdapter.fetchProfile(mockAccount)
      ).rejects.toThrowError(
        new AdapterError(
          "facebook",
          "UPSTREAM_ERROR",
          "Invalid profile payload received from Facebook"
        )
      );
    });
  });
});
