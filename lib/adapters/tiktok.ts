import { config } from "@/lib/config";
import {
  AdapterError,
  type ConnectedAccount,
  type ExchangeResult,
  type Platform,
  type PlatformAdapter,
  type ProfileSnapshot,
  type TokenSet,
} from "./types";

const TIKTOK_AUTH_ENDPOINT = "https://www.tiktok.com/v2/auth/authorize/";
const TIKTOK_TOKEN_ENDPOINT = "https://open.tiktokapis.com/v2/oauth/token/";
const TIKTOK_USER_ENDPOINT = "https://open.tiktokapis.com/v2/user/info/";
const TIKTOK_SCOPE = "user.info.basic,user.info.stats,video.list";
const TIKTOK_USER_FIELDS =
  "open_id,union_id,avatar_url,display_name,follower_count,following_count,likes_count,video_count";

interface TikTokTokenResponse {
  access_token?: string;
  expires_in?: number;
  open_id?: string;
  refresh_expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
  log_id?: string;
}

interface TikTokUserData {
  open_id: string;
  union_id?: string;
  display_name?: string;
  avatar_url?: string;
  follower_count?: number;
  following_count?: number;
  likes_count?: number;
  video_count?: number;
}

interface TikTokUserInfoResponse {
  data?: {
    user?: TikTokUserData;
  };
  error?: {
    code?: string;
    message?: string;
    log_id?: string;
  };
}

async function fetchTikTokUser(
  accessToken: string,
  fields: string = TIKTOK_USER_FIELDS
): Promise<TikTokUserData> {
  const url = new URL(TIKTOK_USER_ENDPOINT);
  url.searchParams.set("fields", fields);

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (res.status === 401) {
    throw new AdapterError("tiktok", "UNAUTHORIZED", "access token expired or invalid");
  }

  if (res.status === 429) {
    throw new AdapterError("tiktok", "RATE_LIMITED", "rate limit exceeded");
  }

  let body: TikTokUserInfoResponse | undefined;
  try {
    body = (await res.json()) as TikTokUserInfoResponse;
  } catch {
    // fallback to statusText handling below
  }

  if (body?.error && body.error.code !== "ok") {
    if (body.error.code === "access_token_invalid") {
      throw new AdapterError(
        "tiktok",
        "UNAUTHORIZED",
        body.error.message || "access token expired or invalid"
      );
    }
    if (body.error.code === "rate_limit_exceeded") {
      throw new AdapterError(
        "tiktok",
        "RATE_LIMITED",
        body.error.message || "rate limit exceeded"
      );
    }
    throw new AdapterError(
      "tiktok",
      "UPSTREAM_ERROR",
      body.error.message || `TikTok API error: ${body.error.code}`
    );
  }

  if (!res.ok) {
    const errorMsg = body?.error?.message || res.statusText || "failed to fetch user info";
    throw new AdapterError("tiktok", "UPSTREAM_ERROR", `failed to fetch user info: ${errorMsg}`);
  }

  const user = body?.data?.user;
  if (!user) {
    throw new AdapterError(
      "tiktok",
      "NOT_FOUND",
      "No user profile found for this TikTok account"
    );
  }

  return user;
}

export class TikTokAdapter implements PlatformAdapter {
  readonly platform: Platform = "tiktok";

  authUrl(state: string): string {
    const url = new URL(TIKTOK_AUTH_ENDPOINT);
    url.searchParams.set("client_key", config.tiktok.clientKey);
    url.searchParams.set("redirect_uri", config.tiktok.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", TIKTOK_SCOPE);
    url.searchParams.set("state", state);
    return url.toString();
  }

  async exchangeCode(code: string): Promise<ExchangeResult> {
    const body = new URLSearchParams({
      client_key: config.tiktok.clientKey,
      client_secret: config.tiktok.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: config.tiktok.redirectUri,
    });

    const res = await fetch(TIKTOK_TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    let tokenData: TikTokTokenResponse | undefined;
    try {
      tokenData = (await res.json()) as TikTokTokenResponse;
    } catch {
      // fallback to statusText handling below
    }

    if (!res.ok || tokenData?.error) {
      const errorMsg =
        tokenData?.error_description ||
        tokenData?.error ||
        res.statusText ||
        "failed to exchange code";
      throw new AdapterError(
        "tiktok",
        "UPSTREAM_ERROR",
        `failed to exchange code: ${errorMsg}`
      );
    }

    if (!tokenData?.access_token || !tokenData?.open_id) {
      throw new AdapterError(
        "tiktok",
        "UPSTREAM_ERROR",
        "malformed token response from TikTok (missing access_token or open_id)"
      );
    }

    const expiresAt = tokenData.expires_in
      ? new Date(Date.now() + tokenData.expires_in * 1000)
      : undefined;

    // Fetch user display_name to populate handle in ExchangeResult
    const user = await fetchTikTokUser(tokenData.access_token, "open_id,display_name");
    const handle = user.display_name || user.open_id;

    return {
      tokens: {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        expiresAt,
      },
      externalId: tokenData.open_id,
      handle,
    };
  }

  async refresh(tokens: TokenSet): Promise<TokenSet> {
    if (!tokens.refreshToken) {
      throw new AdapterError("tiktok", "REVOKED", "refresh token missing");
    }

    const body = new URLSearchParams({
      client_key: config.tiktok.clientKey,
      client_secret: config.tiktok.clientSecret,
      grant_type: "refresh_token",
      refresh_token: tokens.refreshToken,
    });

    const res = await fetch(TIKTOK_TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    let tokenData: TikTokTokenResponse | undefined;
    try {
      tokenData = (await res.json()) as TikTokTokenResponse;
    } catch {
      // fallback to statusText handling below
    }

    if (!res.ok || tokenData?.error) {
      if (tokenData?.error === "invalid_grant") {
        throw new AdapterError(
          "tiktok",
          "REVOKED",
          "token revoked or expired (invalid_grant)"
        );
      }
      const errorMsg =
        tokenData?.error_description ||
        tokenData?.error ||
        res.statusText ||
        "failed to refresh token";
      throw new AdapterError(
        "tiktok",
        "UPSTREAM_ERROR",
        `failed to refresh token: ${errorMsg}`
      );
    }

    if (!tokenData?.access_token) {
      throw new AdapterError(
        "tiktok",
        "UPSTREAM_ERROR",
        "malformed token refresh response from TikTok"
      );
    }

    const expiresAt = tokenData.expires_in
      ? new Date(Date.now() + tokenData.expires_in * 1000)
      : undefined;

    return {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token ?? tokens.refreshToken,
      expiresAt,
    };
  }

  async fetchProfile(account: ConnectedAccount): Promise<ProfileSnapshot> {
    const user = await fetchTikTokUser(
      account.tokens.accessToken,
      TIKTOK_USER_FIELDS
    );

    const handle = user.display_name || user.open_id;
    const avatarUrl = user.avatar_url;
    const audienceCount = Number(user.follower_count) || 0;
    const extras: Record<string, unknown> = {
      followingCount: Number(user.following_count) || 0,
      likesCount: Number(user.likes_count) || 0,
      videoCount: Number(user.video_count) || 0,
    };

    if (user.union_id) {
      extras.unionId = user.union_id;
    }

    return {
      handle,
      avatarUrl,
      audienceCount,
      extras,
    };
  }
}

export const tiktokAdapter: PlatformAdapter = new TikTokAdapter();
