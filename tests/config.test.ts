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

  describe("instagram", () => {
    it("returns clientId, clientSecret, and redirectUri when set", () => {
      vi.stubEnv("INSTAGRAM_CLIENT_ID", "instagram-client-id");
      vi.stubEnv("INSTAGRAM_CLIENT_SECRET", "instagram-client-secret");
      vi.stubEnv(
        "INSTAGRAM_REDIRECT_URI",
        "https://app.example.com/api/auth/instagram/callback"
      );

      expect(config.instagram.clientId).toBe("instagram-client-id");
      expect(config.instagram.clientSecret).toBe("instagram-client-secret");
      expect(config.instagram.redirectUri).toBe(
        "https://app.example.com/api/auth/instagram/callback"
      );
    });

    it("throws when INSTAGRAM_CLIENT_ID is missing", () => {
      vi.stubEnv("INSTAGRAM_CLIENT_ID", "");
      expect(() => config.instagram.clientId).toThrow(
        "INSTAGRAM_CLIENT_ID is not set"
      );
    });

    it("throws when INSTAGRAM_CLIENT_SECRET is missing", () => {
      vi.stubEnv("INSTAGRAM_CLIENT_SECRET", "");
      expect(() => config.instagram.clientSecret).toThrow(
        "INSTAGRAM_CLIENT_SECRET is not set"
      );
    });

    it("throws when INSTAGRAM_REDIRECT_URI is missing", () => {
      vi.stubEnv("INSTAGRAM_REDIRECT_URI", "");
      expect(() => config.instagram.redirectUri).toThrow(
        "INSTAGRAM_REDIRECT_URI is not set"
      );
    });
  });
});

