import { describe, expect, it } from "vitest";

import { decodeBytea, encodeBytea } from "@/lib/supabase/bytea";

describe("bytea encoding", () => {
  it("encodes with the leading marker PostgREST expects", () => {
    expect(encodeBytea(Buffer.from([0xde, 0xad]))).toBe("\\xdead");
  });

  it("decodes whether or not the leading marker is present", () => {
    expect(decodeBytea("\\xdead")).toEqual(Buffer.from([0xde, 0xad]));
    expect(decodeBytea("dead")).toEqual(Buffer.from([0xde, 0xad]));
  });

  it("round-trips arbitrary bytes, including NUL and high bytes", () => {
    const payload = Buffer.from([0x00, 0x1f, 0xff, 0xab, 0x00]);

    expect(decodeBytea(encodeBytea(payload))).toEqual(payload);
  });
});
