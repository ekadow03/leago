-- 0008_draft_picks_replica_identity.sql
-- Bug fix: DELETE events on draft_picks were never reaching realtime
-- subscribers (undoLastPick's delete was silent to other clients).
--
-- Cause: Postgres's default REPLICA IDENTITY only includes a row's primary
-- key in the "old row" snapshot sent for DELETE/UPDATE events. Our RLS
-- policy for reading draft_picks needs draft_session_id (a non-PK column)
-- to decide whether a subscriber is allowed to see the event — with the
-- default identity, that column isn't present in the old-row snapshot, so
-- Realtime can't evaluate the policy and silently drops the event.
--
-- Fix: tell Postgres to include the full row (not just the PK) in
-- before-images for this table, so RLS has what it needs to evaluate.

alter table draft_picks replica identity full;