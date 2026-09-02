-- 0025_blackout_date_ranges.sql
--
-- Extends the 'date' blackout kind (migration 0017) to optionally cover a
-- whole span of days instead of just one, and to optionally restrict that
-- span to specific weekdays — e.g. "weekdays only, 5:30-9pm, Oct 20 -
-- Mar 1" for lack-of-sunlight evening games, or "Dec 20 - Jan 2, all day"
-- for a full winter break. A 'date' blackout with no end_date behaves
-- exactly as before (a single day) — fully backward compatible.
--
-- end_date is only meaningful for kind='date'; 'weekly' and 'daily'
-- already repeat for the whole season and don't need a range. The
-- existing start_time/end_time pair still applies per matching day
-- within the range, same as it already does for a single date or a
-- weekly recurrence — see isBlackedOut() in lib/actions/auto-schedule.ts.
--
-- days_of_week is null/empty for "every day in the range" (the default —
-- matches how a plain single-day blackout has always worked) or a list
-- of 0=Sun..6=Sat values to only black out those weekdays within the
-- range.

alter table blackouts add column end_date date;
alter table blackouts add column days_of_week int[];

alter table blackouts add constraint blackouts_end_date_range
  check (end_date is null or blackout_date is null or end_date >= blackout_date);

comment on column blackouts.end_date is
  'Optional. When set on a kind=''date'' blackout, extends blackout_date into a range [blackout_date, end_date] instead of a single day.';
comment on column blackouts.days_of_week is
  'Optional, only meaningful alongside end_date. 0=Sun..6=Sat. Null/empty means every day in the range; otherwise restricts the blackout to just those weekdays within it (e.g. weekdays-only for a stretch of the season).';
