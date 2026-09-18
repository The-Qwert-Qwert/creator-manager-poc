import { beforeEach, describe, expect, it, vi } from "vitest";

import { AdapterError } from "@/lib/adapters/types";

const state = vi.hoisted(() => ({
  account: null as Record<string, unknown> | null,
  accountFilters: [] as [string, string][],
  accountUpdates: [] as Record<string, unknown>[],
  snapshotUpserts: [] as Record<string, unknown>[],
  fetchProfileCalls: 0,
  fetchProfile: async (): Promise<unknown> => ({
    handle: "creator",
    avatarUrl: null,
    audienceCount: 0,
    extras: {},
  }),
}));

interface AccountQuery {
  eq(column: string, value: string): AccountQuery;
  maybeSingle(): Promise<{ data: Record<string, unknown> | null; error: null }>;
}

class RedirectError extends Error {
  constructor(readonly url: string) {
    super(`NEXT_REDIRECT:${url}`);
  }
}

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new RedirectError(url);
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/token-crypto", () => ({
  decryptToken: () => "decrypted-access-token",
}));

vi.mock("@/lib/adapters/registry", () => ({
  registerDefaultAdapters: vi.fn(),
  getAdapter: () => ({
    fetchProfile: () => {
      state.fetchProfileCalls += 1;
      return state.fetchProfile();
    },
  }),
}));

vi.mock("@/lib/auth/session", () => ({
  requireUser: async () => ({
    user: { id: "user-1" },
    supabase: {
      from: (table: string) => {
        if (table === "connected_accounts") {
          return {
            select: () => {
              const query: AccountQuery = {
                eq(column, value) {
                  state.accountFilters.push([column, value]);
                  return query;
                },
                maybeSingle: async () => ({ data: state.account, error: null }),
              };
              return query;
            },
            update: (payload: Record<string, unknown>) => {
              state.accountUpdates.push(payload);
              return { eq: async () => ({ error: null }) };
            },
          };
        }

        return {
          upsert: async (payload: Record<string, unknown>) => {
            state.snapshotUpserts.push(payload);
            return { error: null };
          },
        };
      },
    },
  }),
}));

import { refreshAccount } from "@/app/dashboard/actions";

const ACCOUNT_ID = "acct-1";

function storedAccount(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ACCOUNT_ID,
    platform: "tiktok",
    external_id: "ext-1",
    handle: "creator",
    access_token_enc: "\\x00112233",
    last_manual_refresh_at: null,
    ...overrides,
  };
}

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

async function submit(accountId: string | null = ACCOUNT_ID): Promise<string> {
  const formData = new FormData();
  if (accountId !== null) {
    formData.set("accountId", accountId);
  }

  try {
    await refreshAccount(formData);
  } catch (error) {
    if (error instanceof RedirectError) {
      return error.url;
    }
    throw error;
  }

  throw new Error("refreshAccount completed without redirecting");
}

describe("refreshAccount", () => {
  beforeEach(() => {
    state.account = storedAccount();
    state.accountFilters = [];
    state.accountUpdates = [];
    state.snapshotUpserts = [];
    state.fetchProfileCalls = 0;
    state.fetchProfile = async () => ({
      handle: "creator",
      avatarUrl: null,
      audienceCount: 0,
      extras: {},
    });
  });

  it("refuses a refresh that is still inside the one-hour cooldown", async () => {
    state.account = storedAccount({ last_manual_refresh_at: minutesAgo(10) });

    await expect(submit()).resolves.toBe("/dashboard?refresh=cooldown&platform=tiktok");
    expect(state.fetchProfileCalls).toBe(0);
    expect(state.accountUpdates).toHaveLength(0);
  });

  it("stores today's snapshot and re-baselines the handle on success", async () => {
    state.fetchProfile = async () => ({
      handle: "creator_renamed",
      avatarUrl: "https://example.com/avatar.jpg",
      audienceCount: 1234,
      extras: { videoCount: 3 },
    });

    await expect(submit()).resolves.toBe("/dashboard?refreshed=tiktok");

    expect(state.fetchProfileCalls).toBe(1);
    expect(state.snapshotUpserts).toEqual([
      {
        connected_account_id: ACCOUNT_ID,
        captured_on: new Date().toISOString().slice(0, 10),
        audience_count: 1234,
        extras: { videoCount: 3 },
      },
    ]);
    expect(state.accountUpdates.at(-1)).toMatchObject({
      handle: "creator_renamed",
      avatar_url: "https://example.com/avatar.jpg",
      status: "active",
    });
  });

  it("claims the cooldown slot before the platform call, so a failure cannot be clicked into a storm", async () => {
    state.fetchProfile = async () => {
      throw new AdapterError("tiktok", "UPSTREAM_ERROR", "upstream exploded");
    };

    await expect(submit()).resolves.toBe("/dashboard?refresh=failed&platform=tiktok");

    expect(state.accountUpdates[0]?.last_manual_refresh_at).toEqual(expect.any(String));
    expect(state.snapshotUpserts).toHaveLength(0);
  });

  it("marks the account for reconnect when the platform rejects the saved token", async () => {
    state.fetchProfile = async () => {
      throw new AdapterError("tiktok", "REVOKED", "token revoked");
    };

    await expect(submit()).resolves.toBe("/dashboard?refresh=expired&platform=tiktok");
    expect(state.accountUpdates.at(-1)).toEqual({ status: "needs_reconnect" });
  });

  it("reports rate limiting without asking the user to reconnect", async () => {
    state.fetchProfile = async () => {
      throw new AdapterError("tiktok", "RATE_LIMITED", "429");
    };

    await expect(submit()).resolves.toBe("/dashboard?refresh=rate_limited&platform=tiktok");
    expect(state.accountUpdates).not.toContainEqual({ status: "needs_reconnect" });
  });

  it("scopes the account lookup to the caller rather than trusting the form id alone", async () => {
    await submit();

    expect(state.accountFilters).toContainEqual(["id", ACCOUNT_ID]);
    expect(state.accountFilters).toContainEqual(["user_id", "user-1"]);
  });

  it("ignores an account the caller does not own", async () => {
    state.account = null;

    await expect(submit("someone-elses-account")).resolves.toBe("/dashboard?refresh=failed");
    expect(state.fetchProfileCalls).toBe(0);
  });

  it("rejects a submission with no account id", async () => {
    await expect(submit(null)).resolves.toBe("/dashboard?refresh=failed");
    expect(state.fetchProfileCalls).toBe(0);
  });
});
