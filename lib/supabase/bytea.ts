/**
 * PostgREST hands `bytea` columns to the client as `"\\x<hex>"` and expects the
 * same form back on write. Both directions live here so the encoding is defined
 * once for every table that stores ciphertext.
 */
export function decodeBytea(value: string): Buffer {
  return Buffer.from(value.startsWith("\\x") ? value.slice(2) : value, "hex");
}

export function encodeBytea(value: Buffer): string {
  return `\\x${value.toString("hex")}`;
}
