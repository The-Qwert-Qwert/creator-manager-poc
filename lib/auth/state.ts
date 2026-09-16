import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { PLATFORMS, type Platform } from "@/lib/adapters/types";

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function getSecret(secret?: string): string {
  const resolved = secret ?? process.env.APP_SECRET;
  if (!resolved) {
    throw new Error("APP_SECRET is not set");
  }
  return resolved;
}

export function generateState(platform: Platform, secret?: string): string {
  const resolvedSecret = getSecret(secret);
  const nonce = randomBytes(16).toString("hex");
  const timestamp = Date.now();
  const payload = Buffer.from(`${platform}:${nonce}:${timestamp}`, "utf8").toString("base64url");
  const hmac = createHmac("sha256", resolvedSecret).update(payload).digest("hex");

  return `${payload}.${hmac}`;
}

export function verifyState(state: string, secret?: string): { platform: Platform } {
  if (!state || typeof state !== "string") {
    throw new Error("state: missing or malformed");
  }

  const parts = state.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error("state: missing or malformed");
  }

  const [payload, hmac] = parts;
  const resolvedSecret = getSecret(secret);
  const expectedHmac = createHmac("sha256", resolvedSecret).update(payload).digest("hex");

  const hmacBuffer = Buffer.from(hmac, "utf8");
  const expectedBuffer = Buffer.from(expectedHmac, "utf8");

  if (
    hmacBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(hmacBuffer, expectedBuffer)
  ) {
    throw new Error("state: invalid signature");
  }

  const decoded = Buffer.from(payload, "base64url").toString("utf8");
  const payloadParts = decoded.split(":");
  if (payloadParts.length !== 3) {
    throw new Error("state: missing or malformed");
  }

  const [platform, nonce, timestampStr] = payloadParts;
  if (!platform || !nonce || !timestampStr) {
    throw new Error("state: missing or malformed");
  }

  const timestamp = Number(timestampStr);

  if (Number.isNaN(timestamp)) {
    throw new Error("state: missing or malformed");
  }

  if (!(PLATFORMS as readonly string[]).includes(platform)) {
    throw new Error("state: unknown platform");
  }

  if (Date.now() - timestamp > STATE_TTL_MS) {
    throw new Error("state: expired");
  }

  return { platform: platform as Platform };
}
