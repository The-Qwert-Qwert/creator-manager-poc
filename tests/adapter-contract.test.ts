import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getAdapter, hasAdapter, registerDefaultAdapters } from "@/lib/adapters/registry";
import {
  AdapterError,
  PLATFORMS,
  type AdapterErrorCode,
  type ConnectedAccount,
  type Platform,
  type PlatformAdapter,
} from "@/lib/adapters/types";

import {
  CONTRACT_METHODS,
  errorRecording,
  FIXTURES,
  type ContractMethod,
  type RecordedResponse,
} from "./fixtures";

const PLATFORM_LIST: Platform[] = [...PLATFORMS];

/** Dev-mode credentials, mirroring what each adapter's own unit test stubs. */
const CREDENTIALS: Record<Platform, Record<string, string>> = {
  youtube: {
    GOOGLE_CLIENT_ID: "contract-client-id",
    GOOGLE_CLIENT_SECRET: "contract-client-secret",
    GOOGLE_REDIRECT_URI: "http://localhost:3000/api/auth/youtube/callback",
  },
  tiktok: {
    TIKTOK_CLIENT_KEY: "contract-client-key",
    TIKTOK_CLIENT_SECRET: "contract-client-secret",
    TIKTOK_REDIRECT_URI: "https://app.example.test/api/auth/tiktok/callback",
  },
  instagram: {
    META_IG_CLIENT_ID: "contract-ig-client-id",
    META_IG_CLIENT_SECRET: "contract-ig-client-secret",
    META_IG_REDIRECT_URI: "http://localhost:3000/api/auth/instagram/callback",
    META_GRAPH_VERSION: "v21.0",
  },
  facebook: {
    META_FB_CLIENT_ID: "contract-fb-client-id",
    META_FB_CLIENT_SECRET: "contract-fb-client-secret",
    META_FB_REDIRECT_URI: "http://localhost:3000/api/auth/facebook/callback",
    META_GRAPH_VERSION: "v21.0",
  },
};

const CONTRACT_ACCOUNTS: Record<Platform, ConnectedAccount> = {
  youtube: {
    id: "contract-account",
    platform: "youtube",
    externalId: "UC_x5XG1OV2P6uZZ5FSM9Ttw",
    tokens: { accessToken: "contract-access-token" },
  },
  tiktok: {
    id: "contract-account",
    platform: "tiktok",
    externalId: "contract_open_id",
    tokens: { accessToken: "contract-access-token" },
  },
  instagram: {
    id: "contract-account",
    platform: "instagram",
    externalId: "17841405793187218",
    tokens: { accessToken: "contract-access-token" },
  },
  facebook: {
    id: "contract-account",
    platform: "facebook",
    externalId: "page_12345",
    tokens: { accessToken: "contract-access-token" },
  },
};

/**
 * Expectations live here rather than in the fixtures — fixtures stay raw data.
 * Platform differences are the point: Facebook reports a dead token as REVOKED
 * and has no refresh flow, Instagram and Facebook both use Meta error subcodes.
 */
const EXPECTED_ERRORS: Record<Platform, Record<string, AdapterErrorCode>> = {
  youtube: {
    "exchangeCode.notFound": "NOT_FOUND",
    "exchangeCode.upstream": "UPSTREAM_ERROR",
    "refresh.revoked": "REVOKED",
    "refresh.upstream": "UPSTREAM_ERROR",
    "fetchProfile.unauthorized": "UNAUTHORIZED",
    "fetchProfile.rateLimited": "RATE_LIMITED",
    "fetchProfile.rateLimitedHttp": "RATE_LIMITED",
    "fetchProfile.notFound": "NOT_FOUND",
    "fetchProfile.upstream": "UPSTREAM_ERROR",
  },
  tiktok: {
    "exchangeCode.upstream": "UPSTREAM_ERROR",
    "refresh.revoked": "REVOKED",
    "refresh.upstream": "UPSTREAM_ERROR",
    "fetchProfile.unauthorized": "UNAUTHORIZED",
    "fetchProfile.unauthorizedBody": "UNAUTHORIZED",
    "fetchProfile.rateLimited": "RATE_LIMITED",
    "fetchProfile.rateLimitedBody": "RATE_LIMITED",
    "fetchProfile.notFound": "NOT_FOUND",
    "fetchProfile.upstream": "UPSTREAM_ERROR",
  },
  instagram: {
    "exchangeCode.upstream": "UPSTREAM_ERROR",
    "refresh.revoked": "REVOKED",
    "refresh.upstream": "UPSTREAM_ERROR",
    "fetchProfile.unauthorized": "UNAUTHORIZED",
    "fetchProfile.rateLimited": "RATE_LIMITED",
    "fetchProfile.revoked": "REVOKED",
    "fetchProfile.notFound": "NOT_FOUND",
    "fetchProfile.upstream": "UPSTREAM_ERROR",
  },
  facebook: {
    "exchangeCode.notFound": "NOT_FOUND",
    "exchangeCode.upstream": "UPSTREAM_ERROR",
    "refresh.revoked": "REVOKED",
    "fetchProfile.revoked": "REVOKED",
    "fetchProfile.unauthorized": "REVOKED",
    "fetchProfile.rateLimited": "RATE_LIMITED",
    "fetchProfile.notFound": "NOT_FOUND",
    "fetchProfile.upstream": "UPSTREAM_ERROR",
  },
};

/** Stands in for the network: replays the recording in call order. */
function stubFetch(recording: RecordedResponse[]) {
  const queue = [...recording];

  const fetchMock = vi.fn(async () => {
    const next = queue.shift();
    if (!next) {
      throw new Error("Fixture recording ran out of responses");
    }

    return new Response(JSON.stringify(next.body ?? {}), {
      status: next.status,
      headers: { "Content-Type": "application/json" },
    });
  });

  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

function invoke(
  adapter: PlatformAdapter,
  method: ContractMethod,
  account: ConnectedAccount,
): Promise<unknown> {
  switch (method) {
    case "exchangeCode":
      return adapter.exchangeCode("contract-code");
    case "refresh":
      return adapter.refresh({
        accessToken: "contract-access-token",
        refreshToken: "contract-refresh-token",
      });
    case "fetchProfile":
      return adapter.fetchProfile(account);
  }
}

async function captureAdapterError(run: () => Promise<unknown>): Promise<AdapterError> {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(AdapterError);
    return error as AdapterError;
  }

  throw new Error("Expected an AdapterError, but the call resolved");
}

describe("adapter contract fixtures", () => {
  it("registers an adapter for every platform in PLATFORMS", () => {
    registerDefaultAdapters();

    for (const platform of PLATFORMS) {
      expect(hasAdapter(platform), `no adapter registered for ${platform}`).toBe(true);
    }
  });

  it("records every method the contract drives for every platform", () => {
    for (const platform of PLATFORMS) {
      for (const method of CONTRACT_METHODS) {
        expect(
          FIXTURES[platform][method].success,
          `${platform} fixture is missing ${method} recordings`,
        ).toBeDefined();
      }
    }
  });
});

describe.each(PLATFORM_LIST)("%s adapter contract", (platform) => {
  const originalFetch = global.fetch;
  const fixture = FIXTURES[platform];

  beforeEach(() => {
    for (const [key, value] of Object.entries(CREDENTIALS[platform])) {
      vi.stubEnv(key, value);
    }
    registerDefaultAdapters();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("exposes the PlatformAdapter surface", () => {
    const adapter = getAdapter(platform);

    expect(adapter.platform).toBe(platform);

    for (const method of ["authUrl", ...CONTRACT_METHODS]) {
      expect(typeof adapter[method as keyof PlatformAdapter]).toBe("function");
    }
  });

  it("builds an https authorization URL that carries the state", () => {
    const url = new URL(getAdapter(platform).authUrl("contract-state"));

    expect(url.protocol).toBe("https:");
    expect(url.searchParams.get("state")).toBe("contract-state");
  });

  it("exchanges a code into tokens, an external id and a handle", async () => {
    stubFetch(fixture.exchangeCode.success);

    const result = await getAdapter(platform).exchangeCode("contract-code");

    expect(result.tokens.accessToken).toBeTruthy();
    expect(result.externalId).toBeTruthy();
    expect(result.handle).toBeTruthy();

    if (result.tokens.expiresAt !== undefined) {
      expect(result.tokens.expiresAt).toBeInstanceOf(Date);
    }
  });

  it("returns a usable token set from refresh", async () => {
    const adapter = getAdapter(platform);

    if (fixture.refresh.success.length === 0) {
      // Facebook Page tokens cannot be refreshed — the contract is an explicit REVOKED.
      const error = await captureAdapterError(() =>
        adapter.refresh({ accessToken: "contract-access-token", refreshToken: "contract-refresh-token" }),
      );

      expect(error.code).toBe("REVOKED");
      return;
    }

    stubFetch(fixture.refresh.success);

    const refreshed = await adapter.refresh({
      accessToken: "contract-access-token",
      refreshToken: "contract-refresh-token",
    });

    expect(refreshed.accessToken).toBeTruthy();
  });

  it("returns a profile snapshot from the recorded profile response", async () => {
    stubFetch(fixture.fetchProfile.success);

    const profile = await getAdapter(platform).fetchProfile(CONTRACT_ACCOUNTS[platform]);

    expect(profile.handle).toBeTruthy();
    expect(Number.isFinite(profile.audienceCount)).toBe(true);
    expect(profile.audienceCount).toBeGreaterThanOrEqual(0);
    expect(typeof profile.extras).toBe("object");
    expect(profile.extras).not.toBeNull();
  });

  it("maps every recorded error response to its documented code", async () => {
    const adapter = getAdapter(platform);
    const table = EXPECTED_ERRORS[platform];
    const assertedKeys = Object.keys(table);

    // Every recording must be asserted, and every assertion must have a recording.
    for (const method of CONTRACT_METHODS) {
      for (const errorKey of Object.keys(fixture[method].errors)) {
        expect(assertedKeys, `${platform} fixture has an unasserted error: ${method}.${errorKey}`).toContain(
          `${method}.${errorKey}`,
        );
      }
    }

    for (const key of assertedKeys) {
      const [method, errorKey] = key.split(".") as [ContractMethod, string];

      stubFetch(errorRecording(fixture, method, errorKey));

      const error = await captureAdapterError(() =>
        invoke(adapter, method, CONTRACT_ACCOUNTS[platform]),
      );

      expect(error.platform).toBe(platform);
      expect(error.code, `${platform} ${key}`).toBe(table[key]);
    }
  });
});
