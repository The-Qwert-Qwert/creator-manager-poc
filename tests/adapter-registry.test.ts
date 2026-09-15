import { beforeEach, describe, expect, it, vi } from "vitest";

import { PLATFORMS, type Platform, type PlatformAdapter } from "@/lib/adapters/types";

type Registry = typeof import("@/lib/adapters/registry");

let registry: Registry;

function fakeAdapter(platform: Platform): PlatformAdapter {
  return {
    platform,
    authUrl: (state) => `https://example.test/${platform}/authorize?state=${state}`,
    exchangeCode: async () => ({
      tokens: { accessToken: `${platform}-access` },
      externalId: `${platform}-external`,
      handle: `${platform}-handle`,
    }),
    refresh: async (tokens) => ({ ...tokens, accessToken: `${platform}-refreshed` }),
    fetchProfile: async (account) => ({
      handle: account.id,
      avatarUrl: `https://cdn.example.test/${platform}.png`,
      audienceCount: 42,
      extras: {},
    }),
  };
}

beforeEach(async () => {
  vi.resetModules();
  registry = await import("@/lib/adapters/registry");
});

describe("adapter registry", () => {
  it("resolves an adapter for every platform enum value", () => {
    const registered = PLATFORMS.map(fakeAdapter);
    registered.forEach((adapter) => registry.registerAdapter(adapter));

    PLATFORMS.forEach((platform) => {
      expect(registry.getAdapter(platform).platform).toBe(platform);
    });
  });

  it("keeps adapters separate per platform", () => {
    const youtube = fakeAdapter("youtube");
    const tiktok = fakeAdapter("tiktok");
    registry.registerAdapter(youtube);
    registry.registerAdapter(tiktok);

    expect(registry.getAdapter("youtube")).toBe(youtube);
    expect(registry.getAdapter("tiktok")).toBe(tiktok);
    expect(registry.hasAdapter("instagram")).toBe(false);
  });

  it("throws for a platform with no registered adapter", () => {
    expect(() => registry.getAdapter("facebook")).toThrow(
      /No adapter registered for platform: facebook/,
    );
  });

  it("reports whether a platform has an adapter", () => {
    expect(registry.hasAdapter("instagram")).toBe(false);

    registry.registerAdapter(fakeAdapter("instagram"));

    expect(registry.hasAdapter("instagram")).toBe(true);
  });

  it("replaces the adapter when a platform registers again", () => {
    const first = fakeAdapter("facebook");
    const second = fakeAdapter("facebook");

    registry.registerAdapter(first);
    registry.registerAdapter(second);

    expect(registry.getAdapter("facebook")).toBe(second);
  });
});
