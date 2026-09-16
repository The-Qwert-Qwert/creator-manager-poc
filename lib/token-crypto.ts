import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { config } from "@/lib/config";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;

function getKey(): Buffer {
  return Buffer.from(config.tokenEncKey, "hex");
}

export function encryptToken(token: string, key?: Buffer): Buffer {
  const resolvedKey = key ?? getKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, resolvedKey, iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);

  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}

export function decryptToken(payload: Buffer, key?: Buffer): string {
  const resolvedKey = key ?? getKey();
  if (payload.length < IV_BYTES + TAG_BYTES) {
    throw new Error("Encrypted token payload is malformed");
  }

  const iv = payload.subarray(0, IV_BYTES);
  const tag = payload.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = payload.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv(ALGORITHM, resolvedKey, iv);
  decipher.setAuthTag(tag);

  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("Token decryption failed: wrong key or tampered payload");
  }
}
