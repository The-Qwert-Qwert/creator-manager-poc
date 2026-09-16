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
});
