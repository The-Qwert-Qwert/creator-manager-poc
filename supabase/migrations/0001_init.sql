-- FSD §7 schema

CREATE TYPE platform_enum AS ENUM ('youtube', 'tiktok', 'instagram', 'facebook');
CREATE TYPE account_status_enum AS ENUM ('active', 'needs_reconnect', 'revoked');

CREATE TABLE users (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email      TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE connected_accounts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform            platform_enum NOT NULL,
  external_id         TEXT NOT NULL,
  handle              TEXT NOT NULL,
  avatar_url          TEXT,
  access_token_enc    BYTEA NOT NULL,
  refresh_token_enc   BYTEA,
  token_expires_at    TIMESTAMPTZ,
  scopes              TEXT,
  status              account_status_enum NOT NULL DEFAULT 'active',
  last_synced_at      TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, platform, external_id)
);

CREATE INDEX ON connected_accounts (user_id);
CREATE INDEX ON connected_accounts (status);

CREATE TABLE metric_snapshots (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connected_account_id UUID NOT NULL REFERENCES connected_accounts(id) ON DELETE CASCADE,
  captured_on          DATE NOT NULL,
  audience_count       BIGINT NOT NULL,
  extras               JSONB,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (connected_account_id, captured_on)
);

CREATE INDEX ON metric_snapshots (connected_account_id, captured_on DESC);
