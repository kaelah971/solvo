-- M4 — Community workspace + human approval.

-- Membership roles for community workspaces.
CREATE TYPE solvo_member_role AS ENUM ('owner', 'approver', 'member');

-- New audit event types for the community lifecycle.
ALTER TYPE solvo_audit_event_type ADD VALUE IF NOT EXISTS 'workspace_initialized';
ALTER TYPE solvo_audit_event_type ADD VALUE IF NOT EXISTS 'member_added';
ALTER TYPE solvo_audit_event_type ADD VALUE IF NOT EXISTS 'member_removed';
ALTER TYPE solvo_audit_event_type ADD VALUE IF NOT EXISTS 'role_changed';
ALTER TYPE solvo_audit_event_type ADD VALUE IF NOT EXISTS 'recipient_added';
ALTER TYPE solvo_audit_event_type ADD VALUE IF NOT EXISTS 'approval_rejected';

-- Community membership. Telegram numeric IDs only; usernames are never used
-- as authority. Rows are soft-removed (status 'removed') so the audit trail
-- keeps the full membership history.
CREATE TABLE workspace_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  telegram_user_id text NOT NULL CHECK (telegram_user_id ~ '^\d+$'),
  role solvo_member_role NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspace_members_unique_user UNIQUE (workspace_id, telegram_user_id)
);

CREATE INDEX workspace_members_role_idx ON workspace_members (workspace_id, role);
CREATE INDEX workspace_members_workspace_idx ON workspace_members (workspace_id, status);

CREATE TRIGGER workspace_members_set_updated_at
BEFORE UPDATE ON workspace_members
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Recipient alias directory. The alias is metadata only; identity is the
-- normalized EVM address. One alias per workspace; a wallet may appear under
-- multiple aliases.
CREATE TABLE recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  alias text NOT NULL CHECK (length(alias) BETWEEN 1 AND 32),
  wallet_address text NOT NULL,
  created_by text CHECK (created_by IS NULL OR created_by ~ '^\d+$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recipients_alias_unique UNIQUE (workspace_id, alias),
  CONSTRAINT recipients_address_normalized CHECK (wallet_address = lower(wallet_address))
);

CREATE INDEX recipients_workspace_idx ON recipients (workspace_id);

CREATE TRIGGER recipients_set_updated_at
BEFORE UPDATE ON recipients
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
