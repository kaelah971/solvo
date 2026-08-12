-- M6.1 — align the seeded judge workspace limits with the public judge
-- defaults (0.01 USDC per transaction = 10000 base units, 0.25 USDC daily =
-- 250000 base units). The judge policy reads its caps from configuration;
-- these workspace rows keep the configuration-of-record consistent.
UPDATE workspaces
SET per_transaction_limit_base_units = 10000,
    daily_limit_base_units = 250000
WHERE id = '00000000-0000-4000-8000-000000000003';
