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

const IG_AUTH_ENDPOINT = "https://api.instagram.com/oauth/authorize";
const IG_SHORT_TOKEN_ENDPOINT = "https://api.instagram.com/oauth/access_token";
const IG_LONG_TOKEN_ENDPOINT = "https://graph.instagram.com/access_token";
const IG_REFRESH_ENDPOINT = "https://graph.instagram.com/refresh_access_token";
const IG_SCOPE = "instagram_business_basic";
const IG_PROFILE_FIELDS = "id,username,followers_count,profile_picture_url";

function getIgProfileEndpoint(): string {
  return `https://graph.instagram.com/${config.meta.graphVersion}/me`;
}

interface InstagramShortTokenResponse {
  access_token?: string;
  user_id?: number | string;
  permissions?: string[];
  error_type?: string;
  code?: number;
  error_message?: string;
}

interface InstagramLongTokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
}

interface InstagramProfileResponse {
  id?: string;
  username?: string;
  followers_count?: number;
  profile_picture_url?: string;
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
}

interface InstagramErrorPayload {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
  error_message?: string;
}

async function fetchInstagramProfile(
  accessToken: string
): Promise<InstagramProfileResponse> {
  const url = new URL(getIgProfileEndpoint());
  url.searchParams.set("fields", IG_PROFILE_FIELDS);

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (res.status === 401) {
    throw new AdapterError(
      "instagram",
      "UNAUTHORIZED",
      "Instagram access token expired or invalid"
    );
  }

  if (res.status === 429) {
    throw new AdapterError(
      "instagram",
      "RATE_LIMITED",
      "Instagram rate limit exceeded"
    );
  }

  if (!res.ok) {
    let errorMsg = res.statusText;
    let errorCode: number | undefined;
    let errorSubcode: number | undefined;

    try {
      const errData = (await res.json()) as InstagramErrorPayload;
      if (errData.error) {
        errorMsg = errData.error.message || errorMsg;
        errorCode = errData.error.code;
        errorSubcode = errData.error.error_subcode;
      } else if (errData.error_message) {
        errorMsg = errData.error_message;
      }
    } catch {
      // fallback to statusText
    }

    if (
      errorCode === 190 &&
      errorSubcode !== undefined &&
      [460, 463, 467].includes(errorSubcode)
    ) {
      throw new AdapterError(
        "instagram",
        "REVOKED",
        `Instagram token revoked or invalid: ${errorMsg}`
      );
    }

    throw new AdapterError(
      "instagram",
      "UPSTREAM_ERROR",
      `Failed to fetch Instagram profile: ${errorMsg}`
    );
  }

  const data = (await res.json()) as InstagramProfileResponse;

  if (!data.id || !data.username) {
    throw new AdapterError(
      "instagram",
      "NOT_FOUND",
      "Instagram profile missing id or username"
    );
  }

  return data;
}

export class InstagramAdapter implements PlatformAdapter {
  readonly platform: Platform = "instagram";

  authUrl(state: string): string {
    const url = new URL(IG_AUTH_ENDPOINT);
    url.searchParams.set("client_id", config.meta.ig.clientId);
    url.searchParams.set("redirect_uri", config.meta.ig.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", IG_SCOPE);
    url.searchParams.set("state", state);
    return url.toString();
  }

  async exchangeCode(code: string): Promise<ExchangeResult> {
    // 1. Sanitize code (strip trailing #_ or fragment commonly appended by Meta OAuth redirect)
    const cleanCode = code.replace(/#_.*$/, "");

    // 2. Short-lived token exchange
    const body = new URLSearchParams({
      client_id: config.meta.ig.clientId,
      client_secret: config.meta.ig.clientSecret,
      grant_type: "authorization_code",
      redirect_uri: config.meta.ig.redirectUri,
      code: cleanCode,
    });

    const shortRes = await fetch(IG_SHORT_TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    if (!shortRes.ok) {
      let errorMsg = shortRes.statusText;
      try {
        const errData = (await shortRes.json()) as InstagramShortTokenResponse;
        errorMsg = errData.error_message || errorMsg;
      } catch {
        // fallback to statusText
      }
      throw new AdapterError(
        "instagram",
        "UPSTREAM_ERROR",
        `Failed to exchange authorization code: ${errorMsg}`
      );
    }

    const shortData = (await shortRes.json()) as InstagramShortTokenResponse;
    const shortToken = shortData.access_token;
    if (!shortToken) {
      throw new AdapterError(
        "instagram",
        "UPSTREAM_ERROR",
        "Instagram token exchange did not return an access token"
      );
    }

    // 3. Exchange short-lived token for long-lived token
    const longUrl = new URL(IG_LONG_TOKEN_ENDPOINT);
    longUrl.searchParams.set("grant_type", "ig_exchange_token");
    longUrl.searchParams.set("client_secret", config.meta.ig.clientSecret);
    longUrl.searchParams.set("access_token", shortToken);

    const longRes = await fetch(longUrl.toString());

    if (!longRes.ok) {
      let errorMsg = longRes.statusText;
      try {
        const errData = (await longRes.json()) as InstagramLongTokenResponse;
        errorMsg = errData.error?.message || errorMsg;
      } catch {
        // fallback to statusText
      }
      throw new AdapterError(
        "instagram",
        "UPSTREAM_ERROR",
        `Failed to exchange short-lived token for long-lived token: ${errorMsg}`
      );
    }

    const longData = (await longRes.json()) as InstagramLongTokenResponse;
    const longToken = longData.access_token;
    if (!longToken) {
      throw new AdapterError(
        "instagram",
        "UPSTREAM_ERROR",
        "Instagram long-lived token exchange did not return an access token"
      );
    }

    const expiresAt = longData.expires_in
      ? new Date(Date.now() + longData.expires_in * 1000)
      : undefined;

    // 4. Fetch profile to resolve username and safe string externalId
    const profile = await fetchInstagramProfile(longToken);

    return {
      tokens: {
        accessToken: longToken,
        refreshToken: undefined, // Instagram long-lived token is itself the refreshable token
        expiresAt,
      },
      externalId: profile.id!,
      handle: profile.username!,
    };
  }

  async refresh(tokens: TokenSet): Promise<TokenSet> {
    if (!tokens.accessToken) {
      throw new AdapterError(
        "instagram",
        "REVOKED",
        "Access token missing for refresh"
      );
    }

    const url = new URL(IG_REFRESH_ENDPOINT);
    url.searchParams.set("grant_type", "ig_refresh_token");
    url.searchParams.set("access_token", tokens.accessToken);

    const res = await fetch(url.toString());

    if (!res.ok) {
      let errorMsg = res.statusText;
      let errorCode: number | undefined;
      let errorSubcode: number | undefined;

      try {
        const errData = (await res.json()) as InstagramErrorPayload;
        if (errData.error) {
          errorMsg = errData.error.message || errorMsg;
          errorCode = errData.error.code;
          errorSubcode = errData.error.error_subcode;
        } else if (errData.error_message) {
          errorMsg = errData.error_message;
        }
      } catch {
        // fallback to statusText
      }

      if (
        errorCode === 190 &&
        errorSubcode !== undefined &&
        [460, 463, 467].includes(errorSubcode)
      ) {
        throw new AdapterError(
          "instagram",
          "REVOKED",
          `Instagram token revoked or expired (subcode ${errorSubcode}): ${errorMsg}`
        );
      }

      throw new AdapterError(
        "instagram",
        "UPSTREAM_ERROR",
        `Failed to refresh Instagram token: ${errorMsg}`
      );
    }

    const data = (await res.json()) as InstagramLongTokenResponse;
    if (!data.access_token) {
      throw new AdapterError(
        "instagram",
        "UPSTREAM_ERROR",
        "Instagram refresh did not return an access token"
      );
    }

    const expiresAt = data.expires_in
      ? new Date(Date.now() + data.expires_in * 1000)
      : undefined;

    return {
      accessToken: data.access_token,
      refreshToken: undefined,
      expiresAt,
    };
  }

  async fetchProfile(account: ConnectedAccount): Promise<ProfileSnapshot> {
    const profile = await fetchInstagramProfile(account.tokens.accessToken);

    return {
      handle: profile.username!,
      avatarUrl: profile.profile_picture_url,
      audienceCount: Number(profile.followers_count) || 0,
      extras: {
        igUserId: profile.id!,
      },
    };
  }
}

export const instagramAdapter: PlatformAdapter = new InstagramAdapter();
