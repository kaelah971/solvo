-- M8 — release hardening.
--
-- A claim may reference at most ONE payout, and a payout may be referenced by
-- at most ONE claim. Combined with the guarded setClaimPayoutId update
-- (status='approved' AND payout_id IS NULL), this makes double attachment
-- impossible at the database level.
CREATE UNIQUE INDEX IF NOT EXISTS claim_links_payout_unique
  ON claim_links (payout_id)
  WHERE payout_id IS NOT NULL;
