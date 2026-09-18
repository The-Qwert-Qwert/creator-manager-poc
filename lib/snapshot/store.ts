import type { SupabaseClient } from "@supabase/supabase-js";

import { getAdapter, registerDefaultAdapters } from "@/lib/adapters/registry";
import type { AccountStatus, Platform, ProfileSnapshot, TokenSet } from "@/lib/adapters/types";
import {
  runSnapshot,
  type RunSnapshotOptions,
  type SnapshotAccount,
  type SnapshotRunSummary,
  type SnapshotStore,
} from "@/lib/snapshot/core";
import { createAdminClient } from "@/lib/supabase/admin";
import { decodeBytea, encodeBytea } from "@/lib/supabase/bytea";
import { decryptToken, encryptToken } from "@/lib/token-crypto";

const ACCOUNT_COLUMNS =
  "id, platform, external_id, access_token_enc, refresh_token_enc, token_expires_at";

interface AccountRow {
  id: string;
  platform: Platform;
  external_id: string;
  access_token_enc: string | null;
  refresh_token_enc: string | null;
  token_expires_at: string | null;
}

function undecryptable(row: AccountRow): SnapshotAccount {
  return {
    id: row.id,
    platform: row.platform,
    externalId: row.external_id,
    tokens: null,
  };
}

function toSnapshotAccount(row: AccountRow): SnapshotAccount {
  if (!row.access_token_enc) {
    return undecryptable(row);
  }

  try {
    const tokens: TokenSet = {
      accessToken: decryptToken(decodeBytea(row.access_token_enc)),
    };

    if (row.refresh_token_enc) {
      tokens.refreshToken = decryptToken(decodeBytea(row.refresh_token_enc));
    }
    if (row.token_expires_at) {
      tokens.expiresAt = new Date(row.token_expires_at);
    }

    return {
      id: row.id,
      platform: row.platform,
      externalId: row.external_id,
      tokens,
    };
  } catch {
    // One undecryptable row must not sink the batch — the core isolates it per account.
    return undecryptable(row);
  }
}

export function createSupabaseSnapshotStore(client: SupabaseClient): SnapshotStore {
  return {
    async listActiveAccounts() {
      const { data, error } = await client
        .from("connected_accounts")
        .select(ACCOUNT_COLUMNS)
        .eq("status", "active");

      if (error) {
        throw new Error(`Failed to list active accounts: ${error.message}`);
      }

      return ((data ?? []) as AccountRow[]).map(toSnapshotAccount);
    },

    async upsertSnapshot(row) {
      const { error } = await client.from("metric_snapshots").upsert(
        {
          connected_account_id: row.connectedAccountId,
          captured_on: row.capturedOn,
          audience_count: row.audienceCount,
          extras: row.extras,
        },
        { onConflict: "connected_account_id,captured_on" },
      );

      if (error) {
        throw new Error(`Failed to upsert snapshot: ${error.message}`);
      }
    },

    async markSynced(accountId, profile: ProfileSnapshot, syncedAt: string) {
      const { error } = await client
        .from("connected_accounts")
        .update({
          handle: profile.handle,
          avatar_url: profile.avatarUrl ?? null,
          status: "active",
          last_synced_at: syncedAt,
        })
        .eq("id", accountId);

      if (error) {
        throw new Error(`Failed to mark account synced: ${error.message}`);
      }
    },

    async saveTokens(accountId, tokens: TokenSet) {
      const update: Record<string, string | null> = {
        access_token_enc: encodeBytea(encryptToken(tokens.accessToken)),
        token_expires_at: tokens.expiresAt ? tokens.expiresAt.toISOString() : null,
      };

      // No rotated refresh token means keep the stored one — same rule as the
      // OAuth callback, so a re-connect never silently drops the token.
      if (tokens.refreshToken) {
        update.refresh_token_enc = encodeBytea(encryptToken(tokens.refreshToken));
      }

      const { error } = await client
        .from("connected_accounts")
        .update(update)
        .eq("id", accountId);

      if (error) {
        throw new Error(`Failed to save refreshed tokens: ${error.message}`);
      }
    },

    async setStatus(accountId, status: AccountStatus) {
      const { error } = await client
        .from("connected_accounts")
        .update({ status })
        .eq("id", accountId);

      if (error) {
        throw new Error(`Failed to update account status: ${error.message}`);
      }
    },
  };
}

/** The seam the cron route, local runner and hosted trigger all call (CREAT-25/46/52). */
export async function runDailySnapshot(
  options: Omit<RunSnapshotOptions, "adapterFor"> = {},
): Promise<SnapshotRunSummary> {
  registerDefaultAdapters();

  const store = createSupabaseSnapshotStore(createAdminClient());

  return runSnapshot(store, { adapterFor: getAdapter, ...options });
}
