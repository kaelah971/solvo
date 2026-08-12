-- M3 — Telegram agent foundation.

-- New payout source types for Telegram-originated instructions.
ALTER TYPE solvo_payout_source_type ADD VALUE IF NOT EXISTS 'telegram_command';
ALTER TYPE solvo_payout_source_type ADD VALUE IF NOT EXISTS 'telegram_natural_language';

-- Audit event for deterministic policy rejections.
ALTER TYPE solvo_audit_event_type ADD VALUE IF NOT EXISTS 'policy_blocked';

-- Sandbox workspace (configuration only — no fake activity).
-- Sandbox records are kept separate from the development workspace.
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
  '00000000-0000-4000-8000-000000000002',
  'sandbox',
  'Sandbox',
  '8453',
  '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
  100000,
  1000000,
  'auto',
  'active'
)
ON CONFLICT (id) DO NOTHING;
