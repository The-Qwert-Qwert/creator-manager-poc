import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSupabaseSnapshotStore } from "@/lib/snapshot/store";
import { decodeBytea, encodeBytea } from "@/lib/supabase/bytea";
import { decryptToken, encryptToken } from "@/lib/token-crypto";

interface RecordedCall {
  table: string;
  operation: string;
  payload?: unknown;
  options?: unknown;
  filters: { column: string; value: unknown }[];
}

/**
 * Minimal chainable stand-in for the Supabase client. It records what the store
 * asked for instead of talking to Postgres.
 */
function createClientStub(response: { data?: unknown; error?: { message: string } | null } = {}) {
  const calls: RecordedCall[] = [];
  const result = { data: response.data ?? null, error: response.error ?? null };

  const client = {
    from(table: string) {
      const call: RecordedCall = { table, operation: "", filters: [] };

      const builder = {
        select(columns: string) {
          call.operation = "select";
          call.payload = columns;
          return builder;
        },
        upsert(payload: unknown, options?: unknown) {
          call.operation = "upsert";
          call.payload = payload;
          call.options = options;
          calls.push(call);
          return Promise.resolve(result);
        },
        update(payload: unknown) {
          call.operation = "update";
          call.payload = payload;
          return builder;
        },
        eq(column: string, value: unknown) {
          call.filters.push({ column, value });
          calls.push(call);
          return Promise.resolve(result);
        },
      };

      return builder;
    },
  };

  return { client: client as unknown as SupabaseClient, calls };
}

function accountRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "acc-1",
    platform: "youtube",
    external_id: "UC_channel_1",
    access_token_enc: encodeBytea(encryptToken("stored-access-token")),
    refresh_token_enc: encodeBytea(encryptToken("stored-refresh-token")),
    token_expires_at: "2026-09-19T00:00:00.000Z",
    ...overrides,
  };
}

describe("createSupabaseSnapshotStore", () => {
  beforeEach(() => {
    vi.stubEnv("TOKEN_ENC_KEY", "a".repeat(64));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe("listActiveAccounts", () => {
    it("selects only active accounts and decrypts their tokens", async () => {
      const { client, calls } = createClientStub({ data: [accountRow()] });

      const accounts = await createSupabaseSnapshotStore(client).listActiveAccounts();

      expect(calls[0]).toMatchObject({
        table: "connected_accounts",
        operation: "select",
        filters: [{ column: "status", value: "active" }],
      });
      expect(accounts).toEqual([
        {
          id: "acc-1",
          platform: "youtube",
          externalId: "UC_channel_1",
          tokens: {
            accessToken: "stored-access-token",
            refreshToken: "stored-refresh-token",
            expiresAt: new Date("2026-09-19T00:00:00.000Z"),
          },
        },
      ]);
    });

    it("keeps a row whose ciphertext will not decrypt in the batch as null tokens", async () => {
      const { client } = createClientStub({
        data: [
          accountRow({ access_token_enc: "\\xdeadbeef" }),
          accountRow({ id: "acc-2", platform: "tiktok", refresh_token_enc: null, token_expires_at: null }),
        ],
      });

      const accounts = await createSupabaseSnapshotStore(client).listActiveAccounts();

      expect(accounts).toHaveLength(2);
      expect(accounts[0]?.tokens).toBeNull();
      expect(accounts[1]?.tokens).toEqual({ accessToken: "stored-access-token" });
    });

    it("surfaces a database error instead of silently skipping accounts", async () => {
      const { client } = createClientStub({ error: { message: "permission denied" } });

      await expect(
        createSupabaseSnapshotStore(client).listActiveAccounts(),
      ).rejects.toThrow(/permission denied/);
    });
  });

  describe("upsertSnapshot", () => {
    it("upserts on the account+day conflict target so a rerun cannot duplicate", async () => {
      const { client, calls } = createClientStub();

      await createSupabaseSnapshotStore(client).upsertSnapshot({
        connectedAccountId: "acc-1",
        capturedOn: "2026-09-18",
        audienceCount: 873,
        extras: { videoCount: 13 },
      });

      expect(calls[0]).toMatchObject({
        table: "metric_snapshots",
        operation: "upsert",
        payload: {
          connected_account_id: "acc-1",
          captured_on: "2026-09-18",
          audience_count: 873,
          extras: { videoCount: 13 },
        },
        options: { onConflict: "connected_account_id,captured_on" },
      });
    });
  });

  describe("markSynced", () => {
    it("refreshes handle, avatar, status and last_synced_at", async () => {
      const { client, calls } = createClientStub();

      await createSupabaseSnapshotStore(client).markSynced(
        "acc-1",
        { handle: "@creator", audienceCount: 873, extras: {} },
        "2026-09-18T03:00:00.000Z",
      );

      expect(calls[0]).toMatchObject({
        table: "connected_accounts",
        operation: "update",
        payload: {
          handle: "@creator",
          avatar_url: null,
          status: "active",
          last_synced_at: "2026-09-18T03:00:00.000Z",
        },
        filters: [{ column: "id", value: "acc-1" }],
      });
    });
  });

  describe("saveTokens", () => {
    it("re-encrypts the rotated access token and keeps the stored refresh token", async () => {
      const { client, calls } = createClientStub();

      await createSupabaseSnapshotStore(client).saveTokens("acc-1", {
        accessToken: "rotated-access-token",
        expiresAt: new Date("2026-09-19T00:00:00.000Z"),
      });

      const payload = calls[0]?.payload as {
        access_token_enc: string;
        refresh_token_enc?: string;
        token_expires_at: string | null;
      };

      expect(decryptToken(decodeBytea(payload.access_token_enc))).toBe("rotated-access-token");
      expect(payload.refresh_token_enc).toBeUndefined();
      expect(payload.token_expires_at).toBe("2026-09-19T00:00:00.000Z");
      expect(calls[0]?.filters).toEqual([{ column: "id", value: "acc-1" }]);
    });

    it("stores the rotated refresh token when the platform returns one", async () => {
      const { client, calls } = createClientStub();

      await createSupabaseSnapshotStore(client).saveTokens("acc-1", {
        accessToken: "rotated-access-token",
        refreshToken: "rotated-refresh-token",
      });

      const payload = calls[0]?.payload as { refresh_token_enc: string };

      expect(decryptToken(decodeBytea(payload.refresh_token_enc))).toBe("rotated-refresh-token");
    });
  });

  describe("setStatus", () => {
    it("writes the status transition for one account", async () => {
      const { client, calls } = createClientStub();

      await createSupabaseSnapshotStore(client).setStatus("acc-1", "needs_reconnect");

      expect(calls[0]).toMatchObject({
        table: "connected_accounts",
        operation: "update",
        payload: { status: "needs_reconnect" },
        filters: [{ column: "id", value: "acc-1" }],
      });
    });
  });
});
