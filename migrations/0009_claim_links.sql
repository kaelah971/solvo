-- M7 — Claim Links.

-- Claim lifecycle: created → claimed → approved → executed; created/claimed
-- may be cancelled. Expiry is effective (created claims past expires_at are
-- unclaimable) without mutating the row.
CREATE TYPE solvo_claim_status AS ENUM (
  'created',
  'claimed',
  'expired',
  'cancelled',
  'approved',
  'executed'
);

-- Claim lifecycle audit events.
ALTER TYPE solvo_audit_event_type ADD VALUE IF NOT EXISTS 'claim_created';
ALTER TYPE solvo_audit_event_type ADD VALUE IF NOT EXISTS 'claim_claimed';
ALTER TYPE solvo_audit_event_type ADD VALUE IF NOT EXISTS 'claim_approved';
ALTER TYPE solvo_audit_event_type ADD VALUE IF NOT EXISTS 'claim_rejected';
ALTER TYPE solvo_audit_event_type ADD VALUE IF NOT EXISTS 'claim_executed';

-- A claim link is a payment INTENT: a recipient opens the link and submits a
-- wallet address; funds NEVER move from this page. Execution requires the
-- original sender/workspace to approve the claimed destination, then the
-- existing payout pipeline (KeeperHub simulate → execute → persist → prove).
--
-- Security: only the SHA-256 hash of the secure random token is stored; the
-- raw token is shown once at creation and never persisted. token_prefix is a
-- display-only hint (first chars of the raw token).
CREATE TABLE claim_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  requester_id text NOT NULL CHECK (requester_id ~ '^\d+$'),
  amount_base_units bigint NOT NULL CHECK (amount_base_units > 0),
  currency_symbol text NOT NULL,
  chain_id text NOT NULL,
  token_address text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  token_prefix text NOT NULL,
  status solvo_claim_status NOT NULL DEFAULT 'created',
  claimed_recipient text,
  claimed_recipient text,
  claimed_by text CHECK (claimed_by IS NULL OR claimed_by = 'web' OR claimed_by ~ '^\d+$'),
  claimed_at timestamptz,
  expires_at timestamptz NOT NULL,
  payout_id uuid REFERENCES payouts(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT claims_recipient_normalized CHECK (
    claimed_recipient IS NULL OR claimed_recipient = lower(claimed_recipient)
  ),
  CONSTRAINT claims_claimed_consistency CHECK (
    (claimed_recipient IS NULL AND claimed_at IS NULL AND claimed_by IS NULL)
    OR
    (claimed_recipient IS NOT NULL AND claimed_at IS NOT NULL AND claimed_by IS NOT NULL)
  ),
  CONSTRAINT claims_payout_requires_terminal CHECK (
    payout_id IS NULL OR status IN ('approved', 'executed')
  )
);

CREATE INDEX claim_links_workspace_idx ON claim_links (workspace_id);
CREATE INDEX claim_links_status_idx ON claim_links (status);
CREATE INDEX claim_links_payout_idx ON claim_links (payout_id);

CREATE TRIGGER claim_links_set_updated_at
BEFORE UPDATE ON claim_links
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
