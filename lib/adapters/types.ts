export const PLATFORMS = [
  "youtube",
  "tiktok",
  "instagram",
  "facebook",
] as const;

export type Platform = (typeof PLATFORMS)[number];

export type AccountStatus = "active" | "needs_reconnect" | "revoked";

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
}

export interface ConnectedAccount {
  id: string;
  platform: Platform;
  externalId: string;
  tokens: TokenSet;
}

export interface ExchangeResult {
  tokens: TokenSet;
  externalId: string;
  handle: string;
}

export interface ProfileSnapshot {
  handle: string;
  avatarUrl?: string;
  audienceCount: number;
  extras: Record<string, unknown>;
}

export interface PlatformAdapter {
  readonly platform: Platform;
  authUrl(state: string): string;
  exchangeCode(code: string): Promise<ExchangeResult>;
  refresh(tokens: TokenSet): Promise<TokenSet>;
  fetchProfile(account: ConnectedAccount): Promise<ProfileSnapshot>;
}

export type AdapterErrorCode =
  | "REVOKED" // Token revoked or refresh token dead -> transition account to needs_reconnect
  | "UNAUTHORIZED" // Access token expired -> trigger adapter.refresh() and retry once
  | "RATE_LIMITED" // 429 or quota exceeded -> halt batch, prevent retry storms
  | "NOT_FOUND" // Account has no channel/page -> display user-facing domain notice
  | "UPSTREAM_ERROR"; // 5xx or unparseable response -> skip, retry on next cron cycle

export class AdapterError extends Error {
  constructor(
    public readonly platform: Platform,
    public readonly code: AdapterErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(`[${platform.toUpperCase()}][${code}] ${message}`);
    this.name = "AdapterError";
  }
}
