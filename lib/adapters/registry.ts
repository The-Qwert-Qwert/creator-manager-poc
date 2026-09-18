import type { Platform, PlatformAdapter } from "./types";
import { youtubeAdapter } from "./youtube";
import { tiktokAdapter } from "./tiktok";
import { instagramAdapter } from "./instagram";
import { facebookAdapter } from "./facebook";

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

export function registerDefaultAdapters(): void {
  if (!adapters.has("youtube")) registerAdapter(youtubeAdapter);
  if (!adapters.has("tiktok")) registerAdapter(tiktokAdapter);
  if (!adapters.has("instagram")) registerAdapter(instagramAdapter);
  if (!adapters.has("facebook")) registerAdapter(facebookAdapter);
}
