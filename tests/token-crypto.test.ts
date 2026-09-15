import { afterEach, describe, expect, it, vi } from "vitest";

import { decryptToken, encryptToken } from "@/lib/token-crypto";

const KEY = Buffer.from("a".repeat(64), "hex");
const OTHER_KEY = Buffer.from("b".repeat(64), "hex");

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("encryptToken / decryptToken", () => {
  it("round-trips a token", () => {
    const token = "ya29.a0AfH6SMB-example-access-token";

    expect(decryptToken(encryptToken(token, KEY), KEY)).toBe(token);
  });

  it("round-trips an empty token", () => {
    expect(decryptToken(encryptToken("", KEY), KEY)).toBe("");
  });

  it("round-trips a long unicode token", () => {
    const token = "tök€n-🔐-".repeat(500);

    expect(decryptToken(encryptToken(token, KEY), KEY)).toBe(token);
  });

  it("encrypts the same token to different payloads", () => {
    const token = "same-token";

    expect(encryptToken(token, KEY).equals(encryptToken(token, KEY))).toBe(false);
  });

  it("never embeds the plaintext in the payload", () => {
    const token = "ya29.a0AfH6SMB-example-access-token";
    const payload = encryptToken(token, KEY);

    expect(payload.includes(Buffer.from(token, "utf8"))).toBe(false);
  });

  it("rejects a payload with tampered ciphertext", () => {
    const payload = encryptToken("secret-token", KEY);
    const tampered = Buffer.from(payload);
    tampered.writeUInt8(tampered.readUInt8(tampered.length - 1) ^ 0xff, tampered.length - 1);

    expect(() => decryptToken(tampered, KEY)).toThrow(/tampered/);
  });

  it("rejects a payload with a tampered auth tag", () => {
    const payload = encryptToken("secret-token", KEY);
    const tampered = Buffer.from(payload);
    tampered.writeUInt8(tampered.readUInt8(20) ^ 0xff, 20);

    expect(() => decryptToken(tampered, KEY)).toThrow(/tampered/);
  });

  it("rejects a truncated payload", () => {
    const payload = encryptToken("secret-token", KEY);

    expect(() => decryptToken(payload.subarray(0, 20), KEY)).toThrow(/malformed/);
  });

  it("rejects the wrong key", () => {
    const payload = encryptToken("secret-token", KEY);

    expect(() => decryptToken(payload, OTHER_KEY)).toThrow(/wrong key/);
  });

  it("reads the key from TOKEN_ENC_KEY when none is passed", () => {
    vi.stubEnv("TOKEN_ENC_KEY", "c".repeat(64));

    expect(decryptToken(encryptToken("env-token"))).toBe("env-token");
  });

  it("throws when TOKEN_ENC_KEY is missing", () => {
    vi.stubEnv("TOKEN_ENC_KEY", "");

    expect(() => encryptToken("secret-token")).toThrow(/TOKEN_ENC_KEY is not set/);
  });

  it("throws when TOKEN_ENC_KEY is not 32 bytes of hex", () => {
    vi.stubEnv("TOKEN_ENC_KEY", "not-a-valid-key");

    expect(() => encryptToken("secret-token")).toThrow(/32 bytes/);
  });
});
