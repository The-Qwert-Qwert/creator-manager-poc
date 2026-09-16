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

const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const YOUTUBE_CHANNELS_ENDPOINT =
  "https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true";
const YOUTUBE_SCOPE = "https://www.googleapis.com/auth/youtube.readonly";

interface YouTubeChannelItem {
  id: string;
  snippet?: {
    title?: string;
    customUrl?: string;
    thumbnails?: {
      default?: { url?: string };
      medium?: { url?: string };
      high?: { url?: string };
    };
  };
  statistics?: {
    viewCount?: string;
    subscriberCount?: string;
    hiddenSubscriberCount?: boolean;
    videoCount?: string;
  };
}

interface YouTubeChannelsResponse {
  items?: YouTubeChannelItem[];
  error?: {
    code?: number;
    message?: string;
    errors?: Array<{ reason?: string; message?: string }>;
  };
}

interface GoogleTokenResponse {
  access_token: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
  refresh_token?: string;
  error?: string;
  error_description?: string;
}

async function fetchPrimaryChannel(accessToken: string): Promise<YouTubeChannelItem> {
  const res = await fetch(YOUTUBE_CHANNELS_ENDPOINT, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (res.status === 401) {
    throw new AdapterError("youtube", "UNAUTHORIZED", "token expired");
  }

  if (res.status === 429) {
    throw new AdapterError("youtube", "RATE_LIMITED", "quota exceeded");
  }

  if (!res.ok) {
    let errorMsg = res.statusText;
    let isQuota = res.status === 403;
    try {
      const errData = (await res.json()) as YouTubeChannelsResponse;
      if (errData?.error?.message) {
        errorMsg = errData.error.message;
      }
      if (
        errData?.error?.errors?.some(
          (e) => e.reason === "quotaExceeded" || e.reason === "rateLimitExceeded"
        )
      ) {
        isQuota = true;
      }
    } catch {
      // fallback to statusText
    }

    if (isQuota) {
      throw new AdapterError("youtube", "RATE_LIMITED", errorMsg || "quota exceeded");
    }

    throw new AdapterError(
      "youtube",
      "UPSTREAM_ERROR",
      `failed to fetch channel data: ${errorMsg}`
    );
  }

  const data = (await res.json()) as YouTubeChannelsResponse;
  const channel = data.items?.[0];

  if (!channel) {
    throw new AdapterError(
      "youtube",
      "NOT_FOUND",
      "No YouTube channel found for this Google account"
    );
  }

  return channel;
}

export class YouTubeAdapter implements PlatformAdapter {
  readonly platform: Platform = "youtube";

  authUrl(state: string): string {
    const url = new URL(GOOGLE_AUTH_ENDPOINT);
    url.searchParams.set("client_id", config.google.clientId);
    url.searchParams.set("redirect_uri", config.google.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", YOUTUBE_SCOPE);
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("state", state);
    return url.toString();
  }

  async exchangeCode(code: string): Promise<ExchangeResult> {
    const body = new URLSearchParams({
      code,
      client_id: config.google.clientId,
      client_secret: config.google.clientSecret,
      redirect_uri: config.google.redirectUri,
      grant_type: "authorization_code",
    });

    const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    if (!res.ok) {
      let errorMsg = res.statusText;
      try {
        const errData = (await res.json()) as GoogleTokenResponse;
        errorMsg = errData.error_description || errData.error || errorMsg;
      } catch {
        // use fallback statusText
      }
      throw new AdapterError(
        "youtube",
        "UPSTREAM_ERROR",
        `failed to exchange code: ${errorMsg}`
      );
    }

    const data = (await res.json()) as GoogleTokenResponse;
    const expiresAt = data.expires_in
      ? new Date(Date.now() + data.expires_in * 1000)
      : undefined;

    const channel = await fetchPrimaryChannel(data.access_token);
    const externalId = channel.id;
    const handle =
      channel.snippet?.customUrl || channel.snippet?.title || channel.id;

    return {
      tokens: {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt,
      },
      externalId,
      handle,
    };
  }

  async refresh(tokens: TokenSet): Promise<TokenSet> {
    if (!tokens.refreshToken) {
      throw new AdapterError("youtube", "REVOKED", "refresh token missing");
    }

    const body = new URLSearchParams({
      refresh_token: tokens.refreshToken,
      client_id: config.google.clientId,
      client_secret: config.google.clientSecret,
      grant_type: "refresh_token",
    });

    const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    if (!res.ok) {
      let errorMsg = res.statusText;
      try {
        const errData = (await res.json()) as GoogleTokenResponse;
        if (errData.error === "invalid_grant") {
          throw new AdapterError(
            "youtube",
            "REVOKED",
            "token revoked or expired (invalid_grant)"
          );
        }
        errorMsg = errData.error_description || errData.error || errorMsg;
      } catch (e) {
        if (e instanceof AdapterError) {
          throw e;
        }
      }
      throw new AdapterError(
        "youtube",
        "UPSTREAM_ERROR",
        `failed to refresh token: ${errorMsg}`
      );
    }

    const data = (await res.json()) as GoogleTokenResponse;
    const expiresAt = data.expires_in
      ? new Date(Date.now() + data.expires_in * 1000)
      : undefined;

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? tokens.refreshToken,
      expiresAt,
    };
  }

  async fetchProfile(account: ConnectedAccount): Promise<ProfileSnapshot> {
    const channel = await fetchPrimaryChannel(account.tokens.accessToken);

    const handle =
      channel.snippet?.customUrl || channel.snippet?.title || channel.id;
    const avatarUrl =
      channel.snippet?.thumbnails?.high?.url ??
      channel.snippet?.thumbnails?.medium?.url ??
      channel.snippet?.thumbnails?.default?.url;
    const audienceCount = channel.statistics?.hiddenSubscriberCount
      ? 0
      : Number(channel.statistics?.subscriberCount) || 0;
    const extras = {
      videoCount: Number(channel.statistics?.videoCount) || 0,
      viewCount: Number(channel.statistics?.viewCount) || 0,
      hiddenSubscriberCount: Boolean(
        channel.statistics?.hiddenSubscriberCount
      ),
    };

    return {
      handle,
      avatarUrl,
      audienceCount,
      extras,
    };
  }
}

export const youtubeAdapter: PlatformAdapter = new YouTubeAdapter();
