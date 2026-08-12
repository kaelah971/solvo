-- Development workspace seed (configuration only — no fake activity).
-- Mirrors the real M1 execution configuration: Base mainnet USDC.

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
  '00000000-0000-4000-8000-000000000001',
  'development',
  'Development',
  '8453',
  '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
  100000,
  1000000,
  'auto',
  'active'
)
ON CONFLICT (id) DO NOTHING;
