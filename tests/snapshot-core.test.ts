import { describe, expect, it } from "vitest";

import {
  AdapterError,
  type AccountStatus,
  type Platform,
  type PlatformAdapter,
  type ProfileSnapshot,
  type TokenSet,
} from "@/lib/adapters/types";
import {
  backoffDelayMs,
  runSnapshot,
  utcDayString,
  type RunSnapshotOptions,
  type SnapshotAccount,
  type SnapshotRow,
  type SnapshotStore,
} from "@/lib/snapshot/core";

const NOW = new Date("2026-09-18T03:00:00.000Z");

function account(
  id: string,
  platform: Platform = "youtube",
  tokens: TokenSet | null = { accessToken: "stored-access-token" },
): SnapshotAccount {
  return { id, platform, externalId: `external-${id}`, tokens };
}

interface FakeStore {
  store: SnapshotStore;
  /** Mirrors UNIQUE (connected_account_id, captured_on): a key can only hold one row. */
  rows: Map<string, SnapshotRow>;
  statuses: { accountId: string; status: AccountStatus }[];
  savedTokens: { accountId: string; tokens: TokenSet }[];
  synced: { accountId: string; profile: ProfileSnapshot; syncedAt: string }[];
}

function createFakeStore(accounts: SnapshotAccount[]): FakeStore {
  const rows = new Map<string, SnapshotRow>();
  const statuses: { accountId: string; status: AccountStatus }[] = [];
  const savedTokens: { accountId: string; tokens: TokenSet }[] = [];
  const synced: { accountId: string; profile: ProfileSnapshot; syncedAt: string }[] = [];

  const store: SnapshotStore = {
    listActiveAccounts: async () => accounts,
    upsertSnapshot: async (row) => {
      rows.set(`${row.connectedAccountId}|${row.capturedOn}`, row);
    },
    markSynced: async (accountId, profile, syncedAt) => {
      synced.push({ accountId, profile, syncedAt });
    },
    saveTokens: async (accountId, tokens) => {
      savedTokens.push({ accountId, tokens });
    },
    setStatus: async (accountId, status) => {
      statuses.push({ accountId, status });
    },
  };

  return { store, rows, statuses, savedTokens, synced };
}

function fakeAdapter(
  platform: Platform,
  overrides: Partial<PlatformAdapter> = {},
): PlatformAdapter {
  return {
    platform,
    authUrl: (state) => `https://example.test/${platform}/authorize?state=${state}`,
    exchangeCode: async () => ({
      tokens: { accessToken: `${platform}-access` },
      externalId: `${platform}-external`,
      handle: `${platform}-handle`,
    }),
    refresh: async (tokens) => ({ ...tokens, accessToken: `${platform}-refreshed` }),
    fetchProfile: async () => ({
      handle: `@${platform}`,
      audienceCount: 100,
      extras: {},
    }),
    ...overrides,
  };
}

function runOptions(
  adapters: Partial<Record<Platform, PlatformAdapter>>,
  extra: Partial<RunSnapshotOptions> = {},
) {
  const sleeps: number[] = [];
  const logs: { level: "info" | "error"; message: string }[] = [];

  const options: RunSnapshotOptions = {
    adapterFor: (platform) => {
      const adapter = adapters[platform];
      if (!adapter) {
        throw new Error(`No adapter registered for platform: ${platform}`);
      }
      return adapter;
    },
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
    random: () => 0.5,
    log: (level, message) => {
      logs.push({ level, message });
    },
    ...extra,
  };

  return { options, sleeps, logs };
}

describe("utcDayString", () => {
  it("uses the UTC calendar day, not the server's local one", () => {
    // 00:30 on the 19th in UTC+7 is still the 18th in UTC.
    expect(utcDayString(new Date("2026-09-19T00:30:00+07:00"))).toBe("2026-09-18");
  });

  it("separates the last millisecond of a day from the first of the next", () => {
    expect(utcDayString(new Date("2026-09-18T23:59:59.999Z"))).toBe("2026-09-18");
    expect(utcDayString(new Date("2026-09-19T00:00:00.000Z"))).toBe("2026-09-19");
  });
});

describe("backoffDelayMs", () => {
  it("grows exponentially and stops at the cap", () => {
    const options = { baseMs: 100, maxMs: 800, random: () => 1 };

    expect(backoffDelayMs(0, options)).toBe(100);
    expect(backoffDelayMs(1, options)).toBe(200);
    expect(backoffDelayMs(2, options)).toBe(400);
    expect(backoffDelayMs(3, options)).toBe(800);
    expect(backoffDelayMs(9, options)).toBe(800);
  });

  it("jitters inside the upper half so deferred retries do not line up", () => {
    expect(backoffDelayMs(0, { baseMs: 100, maxMs: 800, random: () => 0 })).toBe(50);
    expect(backoffDelayMs(0, { baseMs: 100, maxMs: 800, random: () => 0.5 })).toBe(75);
  });
});

describe("runSnapshot", () => {
  it("writes one row per active account for the UTC day", async () => {
    const { store, rows, synced } = createFakeStore([account("a1"), account("a2", "tiktok")]);
    const { options } = runOptions({
      youtube: fakeAdapter("youtube", {
        fetchProfile: async () => ({
          handle: "@creator",
          avatarUrl: "https://cdn.test/avatar.jpg",
          audienceCount: 873,
          extras: { videoCount: 13 },
        }),
      }),
      tiktok: fakeAdapter("tiktok"),
    });

    const summary = await runSnapshot(store, { ...options, now: NOW });

    expect(summary).toMatchObject({ capturedOn: "2026-09-18", processed: 2, failed: 0 });
    expect(rows.get("a1|2026-09-18")).toEqual({
      connectedAccountId: "a1",
      capturedOn: "2026-09-18",
      audienceCount: 873,
      extras: { videoCount: 13 },
    });
    expect([...rows.keys()]).toEqual(["a1|2026-09-18", "a2|2026-09-18"]);
    expect(synced.map((entry) => entry.syncedAt)).toEqual([
      NOW.toISOString(),
      NOW.toISOString(),
    ]);
  });

  it("is idempotent: a second run on the same day keeps a single row per account", async () => {
    const { store, rows } = createFakeStore([account("a1")]);
    const { options } = runOptions({ youtube: fakeAdapter("youtube") });

    await runSnapshot(store, { ...options, now: NOW });
    const second = await runSnapshot(store, { ...options, now: NOW });

    expect(rows.size).toBe(1);
    expect(second.processed).toBe(1);
    expect(second.failed).toBe(0);
  });

  it("isolates a failing account and still processes the rest of the batch", async () => {
    const { store, rows } = createFakeStore([
      account("a1"),
      account("a2", "tiktok"),
      account("a3"),
    ]);
    const { options } = runOptions({
      youtube: fakeAdapter("youtube"),
      tiktok: fakeAdapter("tiktok", {
        fetchProfile: async () => {
          throw new AdapterError("tiktok", "UPSTREAM_ERROR", "user info request failed");
        },
      }),
    });

    const summary = await runSnapshot(store, { ...options, now: NOW });

    expect(summary.processed).toBe(2);
    expect(summary.failed).toBe(1);
    expect(summary.failures[0]).toMatchObject({
      accountId: "a2",
      platform: "tiktok",
      code: "UPSTREAM_ERROR",
    });
    expect(rows.has("a1|2026-09-18")).toBe(true);
    expect(rows.has("a3|2026-09-18")).toBe(true);
  });

  it("marks a revoked account needs_reconnect and writes no row", async () => {
    const { store, rows, statuses } = createFakeStore([account("a1", "instagram")]);
    const { options } = runOptions({
      instagram: fakeAdapter("instagram", {
        fetchProfile: async () => {
          throw new AdapterError("instagram", "REVOKED", "session invalidated");
        },
      }),
    });

    const summary = await runSnapshot(store, { ...options, now: NOW });

    expect(summary.needsReconnect).toBe(1);
    expect(statuses).toEqual([{ accountId: "a1", status: "needs_reconnect" }]);
    expect(rows.size).toBe(0);
  });

  it("marks an undecryptable account and still processes its siblings", async () => {
    const { store, rows, statuses } = createFakeStore([
      account("a1", "youtube", null),
      account("a2"),
    ]);
    const { options } = runOptions({ youtube: fakeAdapter("youtube") });

    const summary = await runSnapshot(store, { ...options, now: NOW });

    expect(summary.needsReconnect).toBe(1);
    expect(summary.processed).toBe(1);
    expect(statuses).toEqual([{ accountId: "a1", status: "needs_reconnect" }]);
    expect(rows.has("a2|2026-09-18")).toBe(true);
  });

  it("records a failure for a platform with no registered adapter", async () => {
    const { store, rows } = createFakeStore([account("a1", "facebook")]);
    const { options } = runOptions({});

    const summary = await runSnapshot(store, { ...options, now: NOW });

    expect(summary.failed).toBe(1);
    expect(rows.size).toBe(0);
  });

  describe("expired access token", () => {
    it("refreshes, persists the rotated tokens and retries exactly once", async () => {
      let profileCalls = 0;
      const { store, rows, savedTokens } = createFakeStore([account("a1")]);
      const { options } = runOptions({
        youtube: fakeAdapter("youtube", {
          fetchProfile: async () => {
            profileCalls += 1;
            if (profileCalls === 1) {
              throw new AdapterError("youtube", "UNAUTHORIZED", "token expired");
            }
            return { handle: "@retried", audienceCount: 7, extras: {} };
          },
        }),
      });

      const summary = await runSnapshot(store, { ...options, now: NOW });

      expect(profileCalls).toBe(2);
      expect(savedTokens).toEqual([
        { accountId: "a1", tokens: { accessToken: "youtube-refreshed" } },
      ]);
      expect(rows.get("a1|2026-09-18")?.audienceCount).toBe(7);
      expect(summary.processed).toBe(1);
    });

    it("marks needs_reconnect when the refresh token is dead", async () => {
      const { store, rows, statuses, savedTokens } = createFakeStore([account("a1", "tiktok")]);
      const { options } = runOptions({
        tiktok: fakeAdapter("tiktok", {
          fetchProfile: async () => {
            throw new AdapterError("tiktok", "UNAUTHORIZED", "token expired");
          },
          refresh: async () => {
            throw new AdapterError("tiktok", "REVOKED", "refresh token missing");
          },
        }),
      });

      const summary = await runSnapshot(store, { ...options, now: NOW });

      expect(summary.needsReconnect).toBe(1);
      expect(statuses).toEqual([{ accountId: "a1", status: "needs_reconnect" }]);
      expect(savedTokens).toHaveLength(0);
      expect(rows.size).toBe(0);
    });

    it("does not retry when the refresh fails for any other reason", async () => {
      let profileCalls = 0;
      const { store, statuses } = createFakeStore([account("a1")]);
      const { options } = runOptions({
        youtube: fakeAdapter("youtube", {
          fetchProfile: async () => {
            profileCalls += 1;
            throw new AdapterError("youtube", "UNAUTHORIZED", "token expired");
          },
          refresh: async () => {
            throw new AdapterError("youtube", "UPSTREAM_ERROR", "token endpoint 500");
          },
        }),
      });

      const summary = await runSnapshot(store, { ...options, now: NOW });

      expect(profileCalls).toBe(1);
      expect(summary.failed).toBe(1);
      expect(summary.needsReconnect).toBe(0);
      expect(statuses).toHaveLength(0);
    });
  });

  describe("rate limiting", () => {
    it("backs off once and defers every remaining account to the next cycle", async () => {
      let deferredCalls = 0;
      const { store, rows } = createFakeStore([account("a1"), account("a2", "tiktok")]);
      const { options, sleeps, logs } = runOptions({
        youtube: fakeAdapter("youtube", {
          fetchProfile: async () => {
            throw new AdapterError("youtube", "RATE_LIMITED", "quota exceeded");
          },
        }),
        tiktok: fakeAdapter("tiktok", {
          fetchProfile: async () => {
            deferredCalls += 1;
            return { handle: "@late", audienceCount: 1, extras: {} };
          },
        }),
      });

      const summary = await runSnapshot(store, { ...options, now: NOW });

      expect(sleeps).toEqual([backoffDelayMs(0, { random: () => 0.5 })]);
      expect(deferredCalls).toBe(0);
      expect(summary.deferred).toBe(1);
      expect(summary.rateLimited).toBe(true);
      expect(summary.processed).toBe(0);
      expect(rows.size).toBe(0);
      expect(logs.some((entry) => entry.level === "error")).toBe(true);
    });
  });
});
