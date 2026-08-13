-- M11.5 — Claim reissue audit event.
-- A reissue is a NEW claim link (new row, new token); the old claim is never
-- resurrected. The audit trail records the reissue with old/new claim ids.
ALTER TYPE solvo_audit_event_type ADD VALUE IF NOT EXISTS 'claim_reissued';
