import { afterEach, describe, expect, it, vi } from "vitest";
import { config } from "@/lib/config";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("config", () => {
  describe("appSecret", () => {
    it("returns the secret when APP_SECRET is set", () => {
      vi.stubEnv("APP_SECRET", "super-secret-key");
      expect(config.appSecret).toBe("super-secret-key");
    });

    it("throws when APP_SECRET is missing", () => {
      vi.stubEnv("APP_SECRET", "");
      expect(() => config.appSecret).toThrow("APP_SECRET is not set");
    });
  });

  describe("tokenEncKey", () => {
    it("returns the key when TOKEN_ENC_KEY is 64 hex chars", () => {
      const validKey = "a".repeat(64);
      vi.stubEnv("TOKEN_ENC_KEY", validKey);
      expect(config.tokenEncKey).toBe(validKey);
    });

    it("throws when TOKEN_ENC_KEY is missing", () => {
      vi.stubEnv("TOKEN_ENC_KEY", "");
      expect(() => config.tokenEncKey).toThrow("TOKEN_ENC_KEY is not set");
    });

    it("throws when TOKEN_ENC_KEY is not 64 hex characters", () => {
      vi.stubEnv("TOKEN_ENC_KEY", "not-a-valid-key");
      expect(() => config.tokenEncKey).toThrow(
        "TOKEN_ENC_KEY must be 64 hex characters (32 bytes)"
      );
    });
  });

  describe("supabase", () => {
    it("returns url and keys when set", () => {
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "pub-key-123");
      vi.stubEnv("SUPABASE_SECRET_KEY", "secret-key-456");

      expect(config.supabase.url).toBe("https://example.supabase.co");
      expect(config.supabase.publishableKey).toBe("pub-key-123");
      expect(config.supabase.secretKey).toBe("secret-key-456");
    });

    it("throws when NEXT_PUBLIC_SUPABASE_URL is missing", () => {
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
      expect(() => config.supabase.url).toThrow(
        "NEXT_PUBLIC_SUPABASE_URL is not set"
      );
    });

    it("throws when NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is missing", () => {
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
      expect(() => config.supabase.publishableKey).toThrow(
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is not set"
      );
    });

    it("throws when SUPABASE_SECRET_KEY is missing", () => {
      vi.stubEnv("SUPABASE_SECRET_KEY", "");
      expect(() => config.supabase.secretKey).toThrow(
        "SUPABASE_SECRET_KEY is not set"
      );
    });
  });

  describe("google", () => {
    it("returns clientId, clientSecret, and redirectUri when set", () => {
      vi.stubEnv("GOOGLE_CLIENT_ID", "google-client-id");
      vi.stubEnv("GOOGLE_CLIENT_SECRET", "google-client-secret");
      vi.stubEnv(
        "GOOGLE_REDIRECT_URI",
        "https://app.example.com/api/auth/youtube/callback"
      );

      expect(config.google.clientId).toBe("google-client-id");
      expect(config.google.clientSecret).toBe("google-client-secret");
      expect(config.google.redirectUri).toBe(
        "https://app.example.com/api/auth/youtube/callback"
      );
    });

    it("throws when GOOGLE_CLIENT_ID is missing", () => {
      vi.stubEnv("GOOGLE_CLIENT_ID", "");
      expect(() => config.google.clientId).toThrow(
        "GOOGLE_CLIENT_ID is not set"
      );
    });

    it("throws when GOOGLE_CLIENT_SECRET is missing", () => {
      vi.stubEnv("GOOGLE_CLIENT_SECRET", "");
      expect(() => config.google.clientSecret).toThrow(
        "GOOGLE_CLIENT_SECRET is not set"
      );
    });

    it("throws when GOOGLE_REDIRECT_URI is missing", () => {
      vi.stubEnv("GOOGLE_REDIRECT_URI", "");
      expect(() => config.google.redirectUri).toThrow(
        "GOOGLE_REDIRECT_URI is not set"
      );
    });
  });

  describe("meta", () => {
    describe("graphVersion", () => {
      it("returns graphVersion when set", () => {
        vi.stubEnv("META_GRAPH_VERSION", "v21.0");
        expect(config.meta.graphVersion).toBe("v21.0");
      });

      it("throws when META_GRAPH_VERSION is missing", () => {
        vi.stubEnv("META_GRAPH_VERSION", "");
        expect(() => config.meta.graphVersion).toThrow(
          "META_GRAPH_VERSION is not set"
        );
      });
    });

    describe("ig", () => {
      it("returns clientId, clientSecret, and redirectUri when set", () => {
        vi.stubEnv("META_IG_CLIENT_ID", "instagram-client-id");
        vi.stubEnv("META_IG_CLIENT_SECRET", "instagram-client-secret");
        vi.stubEnv(
          "META_IG_REDIRECT_URI",
          "https://app.example.com/api/auth/instagram/callback"
        );

        expect(config.meta.ig.clientId).toBe("instagram-client-id");
        expect(config.meta.ig.clientSecret).toBe("instagram-client-secret");
        expect(config.meta.ig.redirectUri).toBe(
          "https://app.example.com/api/auth/instagram/callback"
        );
      });

      it("throws when META_IG_CLIENT_ID is missing", () => {
        vi.stubEnv("META_IG_CLIENT_ID", "");
        expect(() => config.meta.ig.clientId).toThrow(
          "META_IG_CLIENT_ID is not set"
        );
      });

      it("throws when META_IG_CLIENT_SECRET is missing", () => {
        vi.stubEnv("META_IG_CLIENT_SECRET", "");
        expect(() => config.meta.ig.clientSecret).toThrow(
          "META_IG_CLIENT_SECRET is not set"
        );
      });

      it("throws when META_IG_REDIRECT_URI is missing", () => {
        vi.stubEnv("META_IG_REDIRECT_URI", "");
        expect(() => config.meta.ig.redirectUri).toThrow(
          "META_IG_REDIRECT_URI is not set"
        );
      });
    });

    describe("fb", () => {
      it("returns clientId, clientSecret, redirectUri, and configId when set", () => {
        vi.stubEnv("META_FB_CLIENT_ID", "facebook-client-id");
        vi.stubEnv("META_FB_CLIENT_SECRET", "facebook-client-secret");
        vi.stubEnv(
          "META_FB_REDIRECT_URI",
          "https://app.example.com/api/auth/facebook/callback"
        );
        vi.stubEnv("META_FB_CONFIG_ID", "facebook-config-id");

        expect(config.meta.fb.clientId).toBe("facebook-client-id");
        expect(config.meta.fb.clientSecret).toBe("facebook-client-secret");
        expect(config.meta.fb.redirectUri).toBe(
          "https://app.example.com/api/auth/facebook/callback"
        );
        expect(config.meta.fb.configId).toBe("facebook-config-id");
      });

      it("returns undefined for configId when META_FB_CONFIG_ID is not set", () => {
        vi.stubEnv("META_FB_CLIENT_ID", "facebook-client-id");
        vi.stubEnv("META_FB_CLIENT_SECRET", "facebook-client-secret");
        vi.stubEnv(
          "META_FB_REDIRECT_URI",
          "https://app.example.com/api/auth/facebook/callback"
        );
        vi.stubEnv("META_FB_CONFIG_ID", "");

        expect(config.meta.fb.configId).toBeUndefined();
      });

      it("throws when META_FB_CLIENT_ID is missing", () => {
        vi.stubEnv("META_FB_CLIENT_ID", "");
        expect(() => config.meta.fb.clientId).toThrow(
          "META_FB_CLIENT_ID is not set"
        );
      });

      it("throws when META_FB_CLIENT_SECRET is missing", () => {
        vi.stubEnv("META_FB_CLIENT_SECRET", "");
        expect(() => config.meta.fb.clientSecret).toThrow(
          "META_FB_CLIENT_SECRET is not set"
        );
      });

      it("throws when META_FB_REDIRECT_URI is missing", () => {
        vi.stubEnv("META_FB_REDIRECT_URI", "");
        expect(() => config.meta.fb.redirectUri).toThrow(
          "META_FB_REDIRECT_URI is not set"
        );
      });
    });
  });

  describe("tiktok", () => {
    it("returns clientKey, clientSecret, and redirectUri when set", () => {
      vi.stubEnv("TIKTOK_CLIENT_KEY", "tiktok-client-key");
      vi.stubEnv("TIKTOK_CLIENT_SECRET", "tiktok-client-secret");
      vi.stubEnv(
        "TIKTOK_REDIRECT_URI",
        "https://app.example.com/api/auth/tiktok/callback"
      );

      expect(config.tiktok.clientKey).toBe("tiktok-client-key");
      expect(config.tiktok.clientSecret).toBe("tiktok-client-secret");
      expect(config.tiktok.redirectUri).toBe(
        "https://app.example.com/api/auth/tiktok/callback"
      );
    });

    it("throws when TIKTOK_CLIENT_KEY is missing", () => {
      vi.stubEnv("TIKTOK_CLIENT_KEY", "");
      expect(() => config.tiktok.clientKey).toThrow(
        "TIKTOK_CLIENT_KEY is not set"
      );
    });

    it("throws when TIKTOK_CLIENT_SECRET is missing", () => {
      vi.stubEnv("TIKTOK_CLIENT_SECRET", "");
      expect(() => config.tiktok.clientSecret).toThrow(
        "TIKTOK_CLIENT_SECRET is not set"
      );
    });

    it("throws when TIKTOK_REDIRECT_URI is missing", () => {
      vi.stubEnv("TIKTOK_REDIRECT_URI", "");
      expect(() => config.tiktok.redirectUri).toThrow(
        "TIKTOK_REDIRECT_URI is not set"
      );
    });
  });

  describe("features", () => {
    describe("enableMeta", () => {
      it("returns true when ENABLE_META is true", () => {
        vi.stubEnv("ENABLE_META", "true");
        expect(config.features.enableMeta).toBe(true);
      });

      it("returns false when ENABLE_META is false", () => {
        vi.stubEnv("ENABLE_META", "false");
        expect(config.features.enableMeta).toBe(false);
      });

      it("defaults to true in development mode when ENABLE_META is unset", () => {
        vi.stubEnv("ENABLE_META", "");
        delete process.env.ENABLE_META;
        vi.stubEnv("NODE_ENV", "development");
        expect(config.features.enableMeta).toBe(true);
      });

      it("defaults to false in production mode when ENABLE_META is unset", () => {
        vi.stubEnv("ENABLE_META", "");
        delete process.env.ENABLE_META;
        vi.stubEnv("NODE_ENV", "production");
        expect(config.features.enableMeta).toBe(false);
      });
    });
  });
});

