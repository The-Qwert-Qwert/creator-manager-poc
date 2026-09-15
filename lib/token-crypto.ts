import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_HEX_LENGTH = KEY_BYTES * 2;
const HEX_PATTERN = /^[0-9a-f]+$/i;

function getKey(): Buffer {
  const raw = process.env.TOKEN_ENC_KEY;

  if (!raw) {
    throw new Error("TOKEN_ENC_KEY is not set");
  }

  if (raw.length !== KEY_HEX_LENGTH || !HEX_PATTERN.test(raw)) {
    throw new Error(`TOKEN_ENC_KEY must be ${KEY_HEX_LENGTH} hex characters (${KEY_BYTES} bytes)`);
  }

  return Buffer.from(raw, "hex");
}

export function encryptToken(token: string, key: Buffer = getKey()): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);

  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}

export function decryptToken(payload: Buffer, key: Buffer = getKey()): string {
  if (payload.length < IV_BYTES + TAG_BYTES) {
    throw new Error("Encrypted token payload is malformed");
  }

  const iv = payload.subarray(0, IV_BYTES);
  const tag = payload.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = payload.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("Token decryption failed: wrong key or tampered payload");
  }
}
