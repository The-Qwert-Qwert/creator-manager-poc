export const PLATFORMS = ["youtube", "tiktok", "instagram", "facebook"] as const;

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
