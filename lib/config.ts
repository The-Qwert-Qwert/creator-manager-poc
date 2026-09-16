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
      return requireEnv("NEXT_PUBLIC_SUPABASE_URL");
    },
    get publishableKey(): string {
      return requireEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
    },
    get secretKey(): string {
      return requireEnv("SUPABASE_SECRET_KEY");
    },
  },
} as const;
