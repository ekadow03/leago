-- 0015_event_week_number_comment.sql
--
-- Documentation-only follow-up to 0014 — no schema change. The original
-- comment described week_number as incrementing per distinct game date,
-- which was also a bug in generateSeasonSchedule() at the time: a round
-- that spilled across two calendar dates (not enough slots on the first
-- date to fit the whole round) got two different week numbers instead of
-- one. Fixed in code to increment per ROUND of the round-robin cycle
-- instead — every team plays at most once per round, so the round index
-- is "which numbered game is this for the team," matching the
-- weekday/weekend game numbering the feature was built around. This
-- comment is corrected to match.

comment on column events.week_number is
  'Sequential schedule-display label set by generateSeasonSchedule() — '
  'increments once per round of the round-robin cycle (every team plays '
  'at most once per round), not per calendar date and not a real '
  'calendar week. A round that spills across multiple dates keeps one '
  'week number across all of them. Null for manually created events.';
