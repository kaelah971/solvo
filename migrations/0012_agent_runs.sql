-- M8 — Agentic payment orchestrator: agent_runs.
--
-- agent_runs is an OBSERVABILITY / orchestration record only. It is NOT a
-- payout or claim state machine: its statuses are the nine agent-recording
-- states, and once a payout or claim exists, that entity's persistence is
-- the authoritative execution state. agent_runs only links to it.
--
-- Security: raw message text is never stored. input_hash (SHA-256) is always
-- stored; raw_text_redacted holds a truncated, secret-scrubbed copy. No
-- keeperhub execution ids or transaction hashes live here.

-- Agent orchestration audit events.
ALTER TYPE solvo_audit_event_type ADD VALUE IF NOT EXISTS 'agent_run_started';
ALTER TYPE solvo_audit_event_type ADD VALUE IF NOT EXISTS 'agent_interpreted';
ALTER TYPE solvo_audit_event_type ADD VALUE IF NOT EXISTS 'agent_decision';

CREATE TABLE agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES workspaces(id) ON DELETE RESTRICT,
  surface text NOT NULL CHECK (surface IN ('telegram')),
  telegram_chat_id text,
  telegram_user_id text,
  telegram_message_id text,
  idempotency_key text NOT NULL UNIQUE,
  provider text NOT NULL,
  status text NOT NULL DEFAULT 'received' CHECK (status IN (
    'received', 'interpreted', 'planned', 'needs_clarification',
    'prepared', 'claim_created', 'blocked', 'unknown', 'failed'
  )),
  intent_kind text CHECK (intent_kind IN (
    'prepare_payment', 'create_claim_link', 'inspect_payment_status',
    'clarify_missing_fields', 'unsupported'
  )),
  plan_action text CHECK (plan_action IN (
    'ask_clarifying_question', 'prepare_payment', 'create_claim_link',
    'inspect_payment_status', 'decline_unsupported'
  )),
  decision_type text CHECK (decision_type IN (
    'ask_clarifying_question', 'prepared_payment', 'prepared_claim_link',
    'status_visible', 'status_not_found', 'blocked', 'unsupported'
  )),
  input_hash text NOT NULL,
  raw_text_redacted text,
  candidates_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  interpretation_json jsonb,
  decision_json jsonb,
  error_code text,
  error_message_redacted text,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  payout_id uuid REFERENCES payouts(id) ON DELETE RESTRICT,
  claim_id uuid REFERENCES claim_links(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX agent_runs_workspace_created_idx ON agent_runs (workspace_id, created_at DESC);
CREATE INDEX agent_runs_user_started_idx ON agent_runs (telegram_user_id, started_at);
CREATE INDEX agent_runs_status_started_idx ON agent_runs (status, started_at);
CREATE INDEX agent_runs_provider_started_idx ON agent_runs (provider, started_at);

CREATE TRIGGER agent_runs_set_updated_at
BEFORE UPDATE ON agent_runs
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
