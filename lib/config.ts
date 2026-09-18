const HEX_PATTERN = /^[0-9a-f]+$/i;

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`${key} is not set`);
  }
  return value;
}

export const config = {
  get appSecret(): string {
    return requireEnv("APP_SECRET");
  },

  get tokenEncKey(): string {
    const raw = requireEnv("TOKEN_ENC_KEY");
    if (raw.length !== 64 || !HEX_PATTERN.test(raw)) {
      throw new Error("TOKEN_ENC_KEY must be 64 hex characters (32 bytes)");
    }
    return raw;
  },

  supabase: {
    get url(): string {
      const val = process.env.NEXT_PUBLIC_SUPABASE_URL;
      if (!val) {
        throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set");
      }
      return val;
    },
    get publishableKey(): string {
      const val = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
      if (!val) {
        throw new Error("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is not set");
      }
      return val;
    },
    get secretKey(): string {
      return requireEnv("SUPABASE_SECRET_KEY");
    },
  },

  google: {
    get clientId(): string {
      return requireEnv("GOOGLE_CLIENT_ID");
    },
    get clientSecret(): string {
      return requireEnv("GOOGLE_CLIENT_SECRET");
    },
    get redirectUri(): string {
      return requireEnv("GOOGLE_REDIRECT_URI");
    },
  },

  meta: {
    get graphVersion(): string {
      return requireEnv("META_GRAPH_VERSION");
    },

    ig: {
      get clientId(): string {
        return requireEnv("META_IG_CLIENT_ID");
      },
      get clientSecret(): string {
        return requireEnv("META_IG_CLIENT_SECRET");
      },
      get redirectUri(): string {
        return requireEnv("META_IG_REDIRECT_URI");
      },
    },

    fb: {
      get clientId(): string {
        return requireEnv("META_FB_CLIENT_ID");
      },
      get clientSecret(): string {
        return requireEnv("META_FB_CLIENT_SECRET");
      },
      get redirectUri(): string {
        return requireEnv("META_FB_REDIRECT_URI");
      },
      get configId(): string | undefined {
        return process.env.META_FB_CONFIG_ID || undefined;
      },
    },
  },

  tiktok: {
    get clientKey(): string {
      return requireEnv("TIKTOK_CLIENT_KEY");
    },
    get clientSecret(): string {
      return requireEnv("TIKTOK_CLIENT_SECRET");
    },
    get redirectUri(): string {
      return requireEnv("TIKTOK_REDIRECT_URI");
    },
  },

  features: {
    get enableMeta(): boolean {
      if (process.env.ENABLE_META !== undefined) {
        return process.env.ENABLE_META === "true";
      }
      return process.env.NODE_ENV === "development";
    },
  },
} as const;
