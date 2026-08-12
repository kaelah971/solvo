-- M6 — Judge Mode.

-- Judge-originated real executions get a dedicated payout source type so the
-- audit trail can filter judge activity without ambiguity.
ALTER TYPE solvo_payout_source_type ADD VALUE IF NOT EXISTS 'judge_telegram';

-- Judge actors are neither workspace members nor owners; they are an
-- explicit allowlisted class for the judge workspace only.
ALTER TYPE solvo_audit_actor_type ADD VALUE IF NOT EXISTS 'judge';

-- Dedicated judge workspace (configuration, not mock data). No fake
-- transactions are seeded anywhere.
--
-- Limits match the judge policy defaults:
--   per_transaction_limit_base_units = 100000  (0.10 USDC)
--   daily_limit_base_units           = 1000000 (1.00 USDC)
-- approval_policy = 'auto_approve_within_judge_policy' — Judge Mode has no
-- human approval step; the deterministic judge policy is the only gate.
INSERT INTO workspaces (
  id,
  mode,
  name,
  chain_id,
  token_address,
  per_transaction_limit_base_units,
  daily_limit_base_units,
  approval_policy,
  status
) VALUES (
  '00000000-0000-4000-8000-000000000003',
  'judge',
  'Judge',
  '8453',
  '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
  100000,
  1000000,
  'auto_approve_within_judge_policy',
  'active'
)
ON CONFLICT (id) DO NOTHING;
