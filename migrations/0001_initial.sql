-- M2 initial schema: Solvo persisted execution state.

-- ── Enums ──────────────────────────────────────────────────────────────

CREATE TYPE solvo_workspace_mode AS ENUM (
  'sandbox',
  'development',
  'personal',
  'community',
  'judge'
);

CREATE TYPE solvo_execution_state AS ENUM (
  'draft',
  'validated',
  'pending_approval',
  'approved',
  'simulating',
  'submitted',
  'confirming',
  'completed',
  'validation_failed',
  'simulation_failed',
  'execution_failed',
  'retrying',
  'cancelled',
  'execution_unknown'
);

CREATE TYPE solvo_payout_source_type AS ENUM (
  'direct',
  'claim_link',
  'batch_csv',
  'm1_proof'
);

CREATE TYPE solvo_attempt_phase AS ENUM (
  'simulation',
  'execution'
);

CREATE TYPE solvo_attempt_status AS ENUM (
  'running',
  'succeeded',
  'failed',
  'unknown'
);

CREATE TYPE solvo_audit_event_type AS ENUM (
  'request_created',
  'validation_passed',
  'validation_failed',
  'approval_required',
  'approval_granted',
  'simulation_started',
  'simulation_passed',
  'simulation_failed',
  'execution_submitted',
  'execution_confirming',
  'execution_completed',
  'execution_failed',
  'execution_unknown',
  'retry_scheduled',
  'payout_cancelled',
  'm1_proof_imported'
);

CREATE TYPE solvo_audit_actor_type AS ENUM (
  'system',
  'operator',
  'workspace_owner',
  'approver',
  'member'
);

-- ── updated_at trigger ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── workspaces ─────────────────────────────────────────────────────────

CREATE TABLE workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mode solvo_workspace_mode NOT NULL,
  name text,
  telegram_chat_id text,
  chain_id text NOT NULL,
  token_address text NOT NULL,
  per_transaction_limit_base_units bigint,
  daily_limit_base_units bigint,
  approval_policy text NOT NULL DEFAULT 'requires_approval',
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspaces_limits_positive CHECK (
    per_transaction_limit_base_units IS NULL OR per_transaction_limit_base_units > 0
  ),
  CONSTRAINT workspaces_daily_positive CHECK (
    daily_limit_base_units IS NULL OR daily_limit_base_units > 0
  )
);

CREATE TRIGGER workspaces_set_updated_at
BEFORE UPDATE ON workspaces
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── payouts ────────────────────────────────────────────────────────────

CREATE TABLE payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  requester_id text,
  source_type solvo_payout_source_type NOT NULL,
  status solvo_execution_state NOT NULL DEFAULT 'draft',
  total_amount_base_units bigint NOT NULL CHECK (total_amount_base_units > 0),
  currency_symbol text NOT NULL,
  chain_id text NOT NULL,
  token_address text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz
);

CREATE INDEX payouts_workspace_created_idx ON payouts (workspace_id, created_at DESC);
CREATE INDEX payouts_status_idx ON payouts (status);

CREATE TRIGGER payouts_set_updated_at
BEFORE UPDATE ON payouts
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── payout_items ───────────────────────────────────────────────────────

CREATE TABLE payout_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payout_id uuid NOT NULL REFERENCES payouts(id) ON DELETE RESTRICT,
  recipient_address text NOT NULL,
  amount_base_units bigint NOT NULL CHECK (amount_base_units > 0),
  memo text,
  status solvo_execution_state NOT NULL DEFAULT 'draft',
  keeperhub_execution_id text,
  transaction_hash text,
  transaction_explorer_url text,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT payout_items_recipient_normalized CHECK (recipient_address = lower(recipient_address)),
  CONSTRAINT payout_items_hash_format CHECK (
    transaction_hash IS NULL OR transaction_hash ~ '^0x[0-9a-f]{64}$'
  ),
  CONSTRAINT payout_items_execution_id_text CHECK (
    keeperhub_execution_id IS NULL OR length(keeperhub_execution_id) > 0
  )
);

CREATE INDEX payout_items_payout_idx ON payout_items (payout_id);
CREATE INDEX payout_items_status_idx ON payout_items (status);
CREATE INDEX payout_items_idempotency_idx ON payout_items (idempotency_key);

CREATE TRIGGER payout_items_set_updated_at
BEFORE UPDATE ON payout_items
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── execution_attempts ─────────────────────────────────────────────────

CREATE TABLE execution_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payout_item_id uuid NOT NULL REFERENCES payout_items(id) ON DELETE RESTRICT,
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  phase solvo_attempt_phase NOT NULL,
  keeperhub_execution_id text,
  transaction_hash text,
  simulation_result jsonb,
  status solvo_attempt_status NOT NULL DEFAULT 'running',
  error_code text,
  error_message text,
  raw_keeperhub_status jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT execution_attempts_unique_per_item UNIQUE (payout_item_id, attempt_number)
);

CREATE INDEX execution_attempts_item_idx ON execution_attempts (payout_item_id, attempt_number DESC);
CREATE INDEX execution_attempts_keeperhub_execution_idx ON execution_attempts (keeperhub_execution_id);

CREATE TRIGGER execution_attempts_set_updated_at
BEFORE UPDATE ON execution_attempts
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── audit_events (append-only) ─────────────────────────────────────────

CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  payout_id uuid REFERENCES payouts(id) ON DELETE RESTRICT,
  payout_item_id uuid REFERENCES payout_items(id) ON DELETE RESTRICT,
  event_type solvo_audit_event_type NOT NULL,
  actor_type solvo_audit_actor_type NOT NULL,
  actor_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_events_workspace_created_idx ON audit_events (workspace_id, created_at DESC);
CREATE INDEX audit_events_payout_idx ON audit_events (payout_id);
CREATE INDEX audit_events_payout_item_idx ON audit_events (payout_item_id);
CREATE INDEX audit_events_type_idx ON audit_events (event_type);
