-- FSD §5 FR-6: manual refresh is server-enforced to at most one run per hour per account
ALTER TABLE connected_accounts
  ADD COLUMN last_manual_refresh_at TIMESTAMPTZ;
