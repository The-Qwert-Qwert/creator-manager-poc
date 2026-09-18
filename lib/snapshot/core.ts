import {
  AdapterError,
  type AccountStatus,
  type AdapterErrorCode,
  type ConnectedAccount,
  type Platform,
  type PlatformAdapter,
  type ProfileSnapshot,
  type TokenSet,
} from "@/lib/adapters/types";

const DEFAULT_BACKOFF_BASE_MS = 250;
const DEFAULT_BACKOFF_MAX_MS = 2_000;

/** The snapshot day is a UTC calendar date — never the server's local one. */
export function utcDayString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Exponential with jitter, so deferred accounts do not retry in lockstep. */
export function backoffDelayMs(
  attempt: number,
  options: { baseMs?: number; maxMs?: number; random?: () => number } = {},
): number {
  const {
    baseMs = DEFAULT_BACKOFF_BASE_MS,
    maxMs = DEFAULT_BACKOFF_MAX_MS,
    random = Math.random,
  } = options;

  const ceiling = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt));
  return Math.round(ceiling * (0.5 + random() * 0.5));
}

export interface SnapshotAccount {
  id: string;
  platform: Platform;
  externalId: string;
  /** null when this account's stored ciphertext could not be decrypted. */
  tokens: TokenSet | null;
}

export interface SnapshotRow {
  connectedAccountId: string;
  capturedOn: string;
  audienceCount: number;
  extras: Record<string, unknown>;
}

export interface SnapshotStore {
  listActiveAccounts(): Promise<SnapshotAccount[]>;
  upsertSnapshot(row: SnapshotRow): Promise<void>;
  markSynced(accountId: string, profile: ProfileSnapshot, syncedAt: string): Promise<void>;
  saveTokens(accountId: string, tokens: TokenSet): Promise<void>;
  setStatus(accountId: string, status: AccountStatus): Promise<void>;
}

export interface SnapshotFailure {
  accountId: string;
  platform: Platform;
  code?: AdapterErrorCode;
  message: string;
}

export interface SnapshotRunSummary {
  capturedOn: string;
  processed: number;
  failed: number;
  deferred: number;
  needsReconnect: number;
  rateLimited: boolean;
  failures: SnapshotFailure[];
}

export type SnapshotLog = (
  level: "info" | "error",
  message: string,
  data?: Record<string, unknown>,
) => void;

export interface RunSnapshotOptions {
  adapterFor: (platform: Platform) => PlatformAdapter;
  now?: Date;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  log?: SnapshotLog;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function defaultLog(
  level: "info" | "error",
  message: string,
  data?: Record<string, unknown>,
): void {
  if (level === "error") {
    console.error(message, data ?? "");
    return;
  }
  console.log(message, data ?? "");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * An expired access token is recoverable: refresh, persist the rotated tokens,
 * retry exactly once. Every other failure is final for this run (FSD §5 FR-5).
 */
async function fetchProfileWithRefresh(
  adapter: PlatformAdapter,
  account: Pick<SnapshotAccount, "id" | "platform" | "externalId">,
  tokens: TokenSet,
  store: SnapshotStore,
): Promise<ProfileSnapshot> {
  const connected: ConnectedAccount = {
    id: account.id,
    platform: account.platform,
    externalId: account.externalId,
    tokens,
  };

  try {
    return await adapter.fetchProfile(connected);
  } catch (error) {
    if (!(error instanceof AdapterError) || error.code !== "UNAUTHORIZED") {
      throw error;
    }
  }

  const refreshed = await adapter.refresh(tokens);
  await store.saveTokens(account.id, refreshed);

  return adapter.fetchProfile({ ...connected, tokens: refreshed });
}

/**
 * The recovery path must never abort the batch it is trying to protect, so a
 * failed status write is logged and swallowed rather than thrown.
 */
async function markNeedsReconnect(
  store: SnapshotStore,
  account: Pick<SnapshotAccount, "id" | "platform">,
  log: SnapshotLog,
): Promise<void> {
  try {
    await store.setStatus(account.id, "needs_reconnect");
  } catch (error) {
    log("error", "[snapshot] could not mark account needs_reconnect", {
      accountId: account.id,
      platform: account.platform,
      message: errorMessage(error),
    });
  }
}

/**
 * FR-3: one snapshot per active account per UTC day. Each account is isolated —
 * a single bad account never stops the batch — and a rate limit defers the
 * remaining accounts to the next cycle instead of retrying into the wall.
 */
export async function runSnapshot(
  store: SnapshotStore,
  options: RunSnapshotOptions,
): Promise<SnapshotRunSummary> {
  const {
    adapterFor,
    now = new Date(),
    sleep = defaultSleep,
    random,
    log = defaultLog,
  } = options;

  const capturedOn = utcDayString(now);
  const syncedAt = now.toISOString();
  const accounts = await store.listActiveAccounts();

  let processed = 0;
  let failed = 0;
  let deferred = 0;
  let needsReconnect = 0;
  let rateLimited = false;
  const failures: SnapshotFailure[] = [];

  for (const account of accounts) {
    if (rateLimited) {
      deferred += 1;
      continue;
    }

    try {
      const tokens = account.tokens;

      if (!tokens) {
        await markNeedsReconnect(store, account, log);
        needsReconnect += 1;
        throw new Error("Stored tokens could not be decrypted");
      }

      const adapter = adapterFor(account.platform);
      const profile = await fetchProfileWithRefresh(adapter, account, tokens, store);

      await store.upsertSnapshot({
        connectedAccountId: account.id,
        capturedOn,
        audienceCount: profile.audienceCount,
        extras: profile.extras,
      });
      await store.markSynced(account.id, profile, syncedAt);
      processed += 1;
    } catch (error) {
      const code = error instanceof AdapterError ? error.code : undefined;
      const message = errorMessage(error);
      failed += 1;
      failures.push({ accountId: account.id, platform: account.platform, code, message });

      if (code === "REVOKED") {
        await markNeedsReconnect(store, account, log);
        needsReconnect += 1;
      } else if (code === "RATE_LIMITED") {
        rateLimited = true;
        await sleep(backoffDelayMs(0, { random }));
      }

      log("error", "[snapshot] account failed", {
        accountId: account.id,
        platform: account.platform,
        code,
        message,
        capturedOn,
      });
    }
  }

  log(rateLimited || failed > 0 ? "error" : "info", "[snapshot] run complete", {
    capturedOn,
    processed,
    failed,
    deferred,
    needsReconnect,
    rateLimited,
  });

  return { capturedOn, processed, failed, deferred, needsReconnect, rateLimited, failures };
}
