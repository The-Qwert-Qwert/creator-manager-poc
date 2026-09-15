import type { Platform, PlatformAdapter } from "./types";

const adapters = new Map<Platform, PlatformAdapter>();

export function registerAdapter(adapter: PlatformAdapter): void {
  adapters.set(adapter.platform, adapter);
}

export function getAdapter(platform: Platform): PlatformAdapter {
  const adapter = adapters.get(platform);

  if (!adapter) {
    throw new Error(`No adapter registered for platform: ${platform}`);
  }

  return adapter;
}

export function hasAdapter(platform: Platform): boolean {
  return adapters.has(platform);
}
