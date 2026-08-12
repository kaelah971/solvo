-- M5 — Batch payouts.

-- Aggregate payout state for batches where some items completed and others
-- did not. Items keep their own per-item states; this state is payout-level
-- only and is terminal (no automatic retry).
ALTER TYPE solvo_execution_state ADD VALUE IF NOT EXISTS 'partially_completed';

-- Telegram multi-recipient batch instruction.
ALTER TYPE solvo_payout_source_type ADD VALUE IF NOT EXISTS 'telegram_batch';

-- Aggregate audit event for a partially completed batch.
ALTER TYPE solvo_audit_event_type ADD VALUE IF NOT EXISTS 'batch_partially_completed';
