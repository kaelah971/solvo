-- M7 delta — the claim page records the recipient without any identity
-- primitive (no Telegram login on the public page), so `claimed_by` is
-- allowed to be the literal marker 'web' in addition to numeric Telegram IDs.
ALTER TABLE claim_links DROP CONSTRAINT claim_links_claimed_by_check;
ALTER TABLE claim_links ADD CONSTRAINT claim_links_claimed_by_check CHECK (
  claimed_by IS NULL OR claimed_by = 'web' OR claimed_by ~ '^\d+$'
);
