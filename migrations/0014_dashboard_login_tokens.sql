-- M12.4 — One-time dashboard login tokens.
--
-- Only the SHA-256 token hash is stored. The raw token is returned exactly
-- once in the Telegram /dashboard reply and is never persisted. Tokens are
-- short-lived (10 minutes) and single-use (used_at set atomically on consume).
CREATE TABLE IF NOT EXISTS dashboard_login_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  telegram_user_id text NOT NULL,
  member_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('owner', 'approver', 'member')),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX dashboard_login_tokens_hash_idx ON dashboard_login_tokens (token_hash);
CREATE INDEX dashboard_login_tokens_workspace_created_idx
  ON dashboard_login_tokens (workspace_id, created_at DESC);
