import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { generateState, verifyState } from "@/lib/auth/state";
import { PLATFORMS } from "@/lib/adapters/types";

const TEST_SECRET = "test-secret-key-1234567890abcdef";

beforeEach(() => {
  vi.stubEnv("APP_SECRET", TEST_SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("generateState / verifyState", () => {
  it("generateState returns a non-empty string", () => {
    const state = generateState("youtube");
    expect(typeof state).toBe("string");
    expect(state.length).toBeGreaterThan(0);
    expect(state).toContain(".");
  });

  it("verifyState(generateState(platform)) returns the correct platform", () => {
    const state = generateState("youtube");
    const result = verifyState(state);
    expect(result).toEqual({ platform: "youtube" });
  });

  it("all four platforms produce valid state tokens", () => {
    for (const platform of PLATFORMS) {
      const state = generateState(platform);
      const result = verifyState(state);
      expect(result.platform).toBe(platform);
    }
  });

  it("rejects tampered signature with 'state: invalid signature'", () => {
    const state = generateState("youtube");
    const [payload, hmac] = state.split(".");
    expect(payload).toBeDefined();
    expect(hmac).toBeDefined();
    if (!payload || !hmac) throw new Error("Unexpected split result");

    // Tamper with the last character of HMAC
    const tamperedChar = hmac.endsWith("0") ? "1" : "0";
    const tamperedHmac = hmac.slice(0, -1) + tamperedChar;
    const tamperedState = `${payload}.${tamperedHmac}`;

    expect(() => verifyState(tamperedState)).toThrow("state: invalid signature");
  });

  it("rejects expired token with 'state: expired'", () => {
    const elevenMinutesAgo = Date.now() - 11 * 60 * 1000;
    const payload = Buffer.from(`youtube:nonce123:${elevenMinutesAgo}`, "utf8").toString("base64url");
    const hmac = createHmac("sha256", TEST_SECRET).update(payload).digest("hex");
    const expiredState = `${payload}.${hmac}`;

    expect(() => verifyState(expiredState)).toThrow("state: expired");
  });

  it("rejects token with unknown platform with 'state: unknown platform'", () => {
    const payload = Buffer.from(`twitch:nonce123:${Date.now()}`, "utf8").toString("base64url");
    const hmac = createHmac("sha256", TEST_SECRET).update(payload).digest("hex");
    const invalidPlatformState = `${payload}.${hmac}`;

    expect(() => verifyState(invalidPlatformState)).toThrow("state: unknown platform");
  });

  it("rejects malformed token with 'state: missing or malformed'", () => {
    expect(() => verifyState("")).toThrow("state: missing or malformed");
    expect(() => verifyState("no-separator-token")).toThrow("state: missing or malformed");
    expect(() => verifyState(".only-hmac")).toThrow("state: missing or malformed");
    expect(() => verifyState("only-payload.")).toThrow("state: missing or malformed");

    // Valid HMAC on malformed internal payload
    const malformedPayload = Buffer.from("invalid-payload", "utf8").toString("base64url");
    const hmac = createHmac("sha256", TEST_SECRET).update(malformedPayload).digest("hex");
    expect(() => verifyState(`${malformedPayload}.${hmac}`)).toThrow("state: missing or malformed");
  });

  it("throws when APP_SECRET is missing", () => {
    vi.stubEnv("APP_SECRET", "");

    expect(() => generateState("youtube")).toThrow(/APP_SECRET is not set/);
    expect(() => verifyState("dummy.state")).toThrow(/APP_SECRET is not set/);
  });
});
