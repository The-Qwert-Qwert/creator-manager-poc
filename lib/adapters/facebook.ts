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

const FB_PAGE_FIELDS = "id,name,followers_count,fan_count,picture";
const FB_DEFAULT_SCOPE = "pages_show_list,pages_read_engagement";

function getFbAuthEndpoint(): string {
  return `https://www.facebook.com/${config.meta.graphVersion}/dialog/oauth`;
}

function getFbTokenEndpoint(): string {
  return `https://graph.facebook.com/${config.meta.graphVersion}/oauth/access_token`;
}

function getFbPagesEndpoint(): string {
  return `https://graph.facebook.com/${config.meta.graphVersion}/me/accounts`;
}

const RATE_LIMIT_CODES = [4, 17, 32, 613];

interface FacebookApiError {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  fbtrace_id?: string;
}

interface FacebookTokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  error?: FacebookApiError;
}

interface FacebookPageAccountItem {
  id: string;
  name: string;
  access_token: string;
  picture?: {
    data?: {
      url?: string;
      is_silhouette?: boolean;
    };
  };
}

interface FacebookAccountsResponse {
  data?: FacebookPageAccountItem[];
  error?: FacebookApiError;
}

interface FacebookPageProfileResponse {
  id?: string;
  name?: string;
  followers_count?: number;
  fan_count?: number;
  picture?: {
    data?: {
      url?: string;
      is_silhouette?: boolean;
    };
  };
  error?: FacebookApiError;
}

export class FacebookAdapter implements PlatformAdapter {
  readonly platform: Platform = "facebook";

  authUrl(state: string): string {
    const url = new URL(getFbAuthEndpoint());
    url.searchParams.set("client_id", config.meta.fb.clientId);
    url.searchParams.set("redirect_uri", config.meta.fb.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("state", state);

    if (config.meta.fb.configId) {
      url.searchParams.set("config_id", config.meta.fb.configId);
    } else {
      url.searchParams.set("scope", FB_DEFAULT_SCOPE);
    }

    return url.toString();
  }

  async exchangeCode(code: string): Promise<ExchangeResult> {
    // Step 1: Exchange auth code for short-lived user token
    const step1Url = new URL(getFbTokenEndpoint());
    step1Url.searchParams.set("client_id", config.meta.fb.clientId);
    step1Url.searchParams.set("client_secret", config.meta.fb.clientSecret);
    step1Url.searchParams.set("redirect_uri", config.meta.fb.redirectUri);
    step1Url.searchParams.set("code", code);

    const step1Res = await fetch(step1Url.toString());
    const step1Data = (await step1Res.json().catch(() => ({}))) as FacebookTokenResponse;

    if (!step1Res.ok || step1Data.error || !step1Data.access_token) {
      const msg = step1Data.error?.message || step1Res.statusText || "unknown error";
      throw new AdapterError(
        "facebook",
        "UPSTREAM_ERROR",
        `Failed to exchange authorization code: ${msg}`
      );
    }

    const shortLivedUserToken = step1Data.access_token;

    // Step 2: Exchange short-lived token for long-lived user token
    const step2Url = new URL(getFbTokenEndpoint());
    step2Url.searchParams.set("grant_type", "fb_exchange_token");
    step2Url.searchParams.set("client_id", config.meta.fb.clientId);
    step2Url.searchParams.set("client_secret", config.meta.fb.clientSecret);
    step2Url.searchParams.set("fb_exchange_token", shortLivedUserToken);

    const step2Res = await fetch(step2Url.toString());
    const step2Data = (await step2Res.json().catch(() => ({}))) as FacebookTokenResponse;

    if (!step2Res.ok || step2Data.error || !step2Data.access_token) {
      const msg = step2Data.error?.message || step2Res.statusText || "unknown error";
      throw new AdapterError(
        "facebook",
        "UPSTREAM_ERROR",
        `Failed to exchange for long-lived user token: ${msg}`
      );
    }

    const longLivedUserToken = step2Data.access_token;

    // Step 3: Query /me/accounts using long-lived user token to retrieve Page access tokens
    const step3Url = new URL(getFbPagesEndpoint());
    step3Url.searchParams.set("fields", "id,name,access_token,picture");
    step3Url.searchParams.set("access_token", longLivedUserToken);

    const step3Res = await fetch(step3Url.toString());
    const step3Data = (await step3Res.json().catch(() => ({}))) as FacebookAccountsResponse;

    if (!step3Res.ok || step3Data.error) {
      const msg = step3Data.error?.message || step3Res.statusText || "unknown error";
      throw new AdapterError(
        "facebook",
        "UPSTREAM_ERROR",
        `Failed to fetch Facebook Pages: ${msg}`
      );
    }

    const pages = step3Data.data;
    if (!pages || pages.length === 0) {
      throw new AdapterError(
        "facebook",
        "NOT_FOUND",
        "No Facebook Pages found for this account"
      );
    }

    const primaryPage = pages[0];
    if (!primaryPage || !primaryPage.id || !primaryPage.access_token) {
      throw new AdapterError(
        "facebook",
        "UPSTREAM_ERROR",
        "Invalid page data received from Facebook"
      );
    }

    return {
      tokens: {
        accessToken: primaryPage.access_token,
        refreshToken: undefined,
        expiresAt: undefined,
      },
      externalId: primaryPage.id,
      handle: primaryPage.name || primaryPage.id,
    };
  }

  async refresh(tokens: TokenSet): Promise<TokenSet> {
    void tokens;
    throw new AdapterError(
      "facebook",
      "REVOKED",
      "Facebook page tokens cannot be refreshed programmatically; re-connect required"
    );
  }

  async fetchProfile(account: ConnectedAccount): Promise<ProfileSnapshot> {
    const url = `https://graph.facebook.com/${config.meta.graphVersion}/${encodeURIComponent(account.externalId)}?fields=${FB_PAGE_FIELDS}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${account.tokens.accessToken}`,
      },
    });

    const data = (await res.json().catch(() => ({}))) as FacebookPageProfileResponse;
    const err = data.error;
    const errCode = err?.code;
    const errMsg = err?.message || res.statusText || "unknown error";

    // 1. Invalid or expired token: code 190 or HTTP 401
    if (errCode === 190 || res.status === 401) {
      throw new AdapterError(
        "facebook",
        "REVOKED",
        errMsg || "Facebook access token revoked or expired"
      );
    }

    // 2. Rate limiting: HTTP 429 or throttling error codes 4, 17, 32, 613
    if (res.status === 429 || (errCode !== undefined && RATE_LIMIT_CODES.includes(errCode))) {
      throw new AdapterError(
        "facebook",
        "RATE_LIMITED",
        errMsg || "Facebook API rate limit exceeded"
      );
    }

    // 3. Object not found / deleted page: HTTP 404 or code 100 with does not exist
    if (res.status === 404 || (errCode === 100 && errMsg.toLowerCase().includes("does not exist"))) {
      throw new AdapterError(
        "facebook",
        "NOT_FOUND",
        errMsg || "Facebook Page not found"
      );
    }

    // 4. Any other non-ok HTTP status or error envelope
    if (!res.ok || err) {
      throw new AdapterError(
        "facebook",
        "UPSTREAM_ERROR",
        `Failed to fetch Facebook Page profile: ${errMsg}`
      );
    }

    if (!data.id) {
      throw new AdapterError(
        "facebook",
        "UPSTREAM_ERROR",
        "Invalid profile payload received from Facebook"
      );
    }

    return {
      handle: data.name || account.externalId,
      avatarUrl: data.picture?.data?.url,
      audienceCount: data.followers_count ?? data.fan_count ?? 0,
      extras: {
        fanCount: data.fan_count,
        pageId: data.id,
      },
    };
  }
}

export const facebookAdapter = new FacebookAdapter();
