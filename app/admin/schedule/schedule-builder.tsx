// app/admin/schedule/schedule-builder.tsx
'use client';

import { useState } from 'react';
import { createEvent, setEventStatus, publishAllDraftEvents, deleteEvent, deleteEvents, updateEvent } from '@/lib/actions/events';

interface Season {
  id: string;
  name: string;
}

interface Division {
  id: string;
  name: string;
  season_id: string;
}

interface Team {
  id: string;
  name: string;
  division_id: string;
}

interface EventRow {
  id: string;
  type: string;
  title: string;
  location: string | null;
  start_time: string;
  end_time: string | null;
  status: string;
  season_id: string | null;
  division_id: string | null;
  home_team_id: string | null;
  away_team_id: string | null;
  week_number: number | null;
}

const EVENT_TYPES = [
  { value: 'game', label: 'Game' },
  { value: 'practice', label: 'Practice' },
  { value: 'volunteer_shift', label: 'Volunteer Shift' },
  { value: 'league_event', label: 'League Event' },
] as const;

function toDatetimeLocal(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// GameChanger's League Bulk Schedule Import expects date/time/home/away/
// location/duration columns, with time as "6:00 PM" (no seconds, no 24hr)
// and duration as a plain integer count of minutes — see
// help.gc.com/hc/en-us/articles/8780588516365. GameChanger doesn't
// publish the exact date format alongside that, so this uses the
// standard US MM/DD/YYYY convention; if their import rejects it, the
// live template downloaded from your GameChanger organization's admin
// portal is the authoritative source to match against.
function formatDateForGameChanger(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()}`;
}

function formatTimeForGameChanger(iso: string): string {
  const d = new Date(iso);
  const hours = d.getHours();
  const period = hours >= 12 ? 'PM' : 'AM';
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${String(d.getMinutes()).padStart(2, '0')} ${period}`;
}

function csvField(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export default function ScheduleBuilder({
  organizationId,
  organizationName,
  seasons,
  divisions,
  teams,
  initialEvents,
}: {
  organizationId: string;
  organizationName: string;
  seasons: Season[];
  divisions: Division[];
  teams: Team[];
  initialEvents: EventRow[];
}) {
  const [events, setEvents] = useState(initialEvents);
  const [error, setError] = useState<string | null>(null);
  const [selectedSeasonId, setSelectedSeasonId] = useState(seasons[0]?.id ?? '');
  const [selectedDivisionId, setSelectedDivisionId] = useState('');

  const [type, setType] = useState<'game' | 'practice' | 'volunteer_shift' | 'league_event'>('game');
  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [startTime, setStartTime] = useState('');
  const [homeTeamId, setHomeTeamId] = useState('');
  const [awayTeamId, setAwayTeamId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editLocation, setEditLocation] = useState('');
  const [editStartTime, setEditStartTime] = useState('');
  const [editHomeTeamId, setEditHomeTeamId] = useState('');
  const [editAwayTeamId, setEditAwayTeamId] = useState('');
  const [editWeekNumber, setEditWeekNumber] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  const divisionsForSeason = divisions.filter((d) => d.season_id === selectedSeasonId);

  const filteredEvents = events.filter(
    (ev) => ev.season_id === selectedSeasonId && (!selectedDivisionId || ev.division_id === selectedDivisionId)
  );

  // Group by week_number so admins reviewing an archived schedule can scan
  // it week-by-week rather than as one long date-ordered list. Events with
  // no week_number (manually added, or created before this feature) fall
  // into an "Unscheduled" bucket at the end.
  const weekGroups = new Map<number | null, EventRow[]>();
  for (const ev of filteredEvents) {
    const key = ev.week_number ?? null;
    if (!weekGroups.has(key)) weekGroups.set(key, []);
    weekGroups.get(key)!.push(ev);
  }
  const sortedWeekKeys = Array.from(weekGroups.keys()).sort((a, b) => {
    if (a === null) return 1;
    if (b === null) return -1;
    return a - b;
  });

  function handleSeasonChange(seasonId: string) {
    setSelectedSeasonId(seasonId);
    setSelectedDivisionId('');
    setSelectedIds(new Set());
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const result = await createEvent({
        organizationId,
        seasonId: selectedSeasonId || undefined,
        type,
        title,
        location: location || undefined,
        startTime: new Date(startTime).toISOString(),
        homeTeamId: type === 'game' ? homeTeamId || undefined : undefined,
        awayTeamId: type === 'game' ? awayTeamId || undefined : undefined,
      });
      if ('error' in result) {
        setError(result.error);
        return;
      }
      setEvents((prev) => [
        ...prev,
        {
          id: result.id,
          type,
          title,
          location: location || null,
          start_time: new Date(startTime).toISOString(),
          end_time: null,
          status: 'draft',
          season_id: selectedSeasonId || null,
          division_id: selectedDivisionId || null,
          home_team_id: homeTeamId || null,
          away_team_id: awayTeamId || null,
          week_number: null,
        },
      ].sort((a, b) => a.start_time.localeCompare(b.start_time)));
      setTitle('');
      setLocation('');
      setStartTime('');
      setHomeTeamId('');
      setAwayTeamId('');
      setShowForm(false);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggleStatus(eventId: string, newStatus: 'draft' | 'published' | 'canceled') {
    setError(null);
    try {
      const result = await setEventStatus(organizationId, eventId, newStatus);
      if ('error' in result) {
        setError(result.error);
        return;
      }
      setEvents((prev) => prev.map((ev) => (ev.id === eventId ? { ...ev, status: newStatus } : ev)));
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleDelete(eventId: string) {
    if (!confirm('Delete this event?')) return;
    setError(null);
    try {
      const result = await deleteEvent(organizationId, eventId);
      if ('error' in result) {
        setError(result.error);
        return;
      }
      setEvents((prev) => prev.filter((ev) => ev.id !== eventId));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(eventId);
        return next;
      });
    } catch (err: any) {
      setError(err.message);
    }
  }

  function toggleSelected(eventId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(eventId)) {
        next.delete(eventId);
      } else {
        next.add(eventId);
      }
      return next;
    });
  }

  function toggleSelectAllVisible() {
    setSelectedIds((prev) => {
      const visibleIds = filteredEvents.map((ev) => ev.id);
      const allSelected = visibleIds.length > 0 && visibleIds.every((id) => prev.has(id));
      if (allSelected) {
        const next = new Set(prev);
        visibleIds.forEach((id) => next.delete(id));
        return next;
      }
      return new Set([...prev, ...visibleIds]);
    });
  }

  async function handleBulkDelete() {
    if (selectedIds.size === 0) return;
    if (!confirm(`Delete ${selectedIds.size} selected event(s)? This can't be undone.`)) return;
    setError(null);
    setBulkDeleting(true);
    try {
      const ids = Array.from(selectedIds);
      const result = await deleteEvents(organizationId, ids);
      if ('error' in result) {
        setError(result.error);
        return;
      }
      setEvents((prev) => prev.filter((ev) => !selectedIds.has(ev.id)));
      setSelectedIds(new Set());
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBulkDeleting(false);
    }
  }

  async function handlePublishAll() {
    if (!selectedSeasonId) return;
    setError(null);
    try {
      const result = await publishAllDraftEvents(organizationId, selectedSeasonId);
      if ('error' in result) {
        setError(result.error);
        return;
      }
      setEvents((prev) =>
        prev.map((ev) => (ev.season_id === selectedSeasonId && ev.status === 'draft' ? { ...ev, status: 'published' } : ev))
      );
      alert(`Published ${result.count} event(s).`);
    } catch (err: any) {
      setError(err.message);
    }
  }

  // Exports whatever is currently filtered (season, and division if one
  // is picked) as a CSV for GameChanger's League Bulk Schedule Import.
  // Only 'game' events with both a home and away team assigned can go in
  // — GameChanger's import has no division/practice concept, it's just
  // games between two teams already in your GameChanger org roster.
  function handleExportGameChanger() {
    const gameEvents = filteredEvents.filter(
      (ev) => ev.type === 'game' && ev.home_team_id && ev.away_team_id
    );
    const skipped = filteredEvents.length - gameEvents.length;

    if (gameEvents.length === 0) {
      alert('No games with both a home and away team set in the current view — pick a season/division with a generated schedule first.');
      return;
    }

    // Games generated with a game duration already carry their own
    // end_time (see the "Game duration" field on the schedule generator),
    // so use that game's own start/end gap when it's there. Only games
    // created before that field existed (or added manually without an
    // end time) fall back to a single duration applied to all of them.
    const missingDuration = gameEvents.some((ev) => !ev.end_time);
    let fallbackDuration = 60;
    if (missingDuration) {
      const durationInput = prompt(
        'Some games have no stored duration (created before the game-duration field, or added manually). ' +
          'Enter a duration in minutes to use for those:',
        '60'
      );
      if (durationInput === null) return;
      fallbackDuration = Math.round(Number(durationInput));
      if (!Number.isFinite(fallbackDuration) || fallbackDuration <= 0) {
        alert('Enter a whole number of minutes greater than 0.');
        return;
      }
    }
    function durationFor(ev: EventRow): number {
      if (ev.end_time) {
        const mins = Math.round((new Date(ev.end_time).getTime() - new Date(ev.start_time).getTime()) / 60000);
        if (mins > 0) return mins;
      }
      return fallbackDuration;
    }

    // GameChanger matches teams by name only (no division field in its
    // import), so two teams sharing a name across different divisions
    // would be ambiguous on their end — flag it rather than silently
    // exporting something that could land on the wrong team.
    const usedTeamIds = new Set<string>();
    gameEvents.forEach((ev) => {
      if (ev.home_team_id) usedTeamIds.add(ev.home_team_id);
      if (ev.away_team_id) usedTeamIds.add(ev.away_team_id);
    });
    const nameCounts = new Map<string, number>();
    teams.forEach((t) => {
      if (usedTeamIds.has(t.id)) {
        nameCounts.set(t.name, (nameCounts.get(t.name) ?? 0) + 1);
      }
    });
    const duplicateNames = Array.from(nameCounts.entries())
      .filter(([, count]) => count > 1)
      .map(([name]) => name);

    const rows: string[][] = [['date', 'time', 'home', 'away', 'location', 'duration']];
    gameEvents.forEach((ev) => {
      rows.push([
        formatDateForGameChanger(ev.start_time),
        formatTimeForGameChanger(ev.start_time),
        teamName(ev.home_team_id),
        teamName(ev.away_team_id),
        ev.location ?? '',
        String(durationFor(ev)),
      ]);
    });

    const csv = rows.map((row) => row.map(csvField).join(',')).join('\n') + '\n';
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'gamechanger-schedule-export.csv';
    a.click();
    URL.revokeObjectURL(url);

    const notes: string[] = [`Exported ${gameEvents.length} game(s).`];
    if (skipped > 0) {
      notes.push(`Skipped ${skipped} event(s) without both teams assigned (practices, league events, or games missing a team).`);
    }
    if (duplicateNames.length > 0) {
      notes.push(`Heads up — these team names appear more than once across your divisions, which GameChanger can't tell apart by name alone: ${duplicateNames.join(', ')}.`);
    }
    alert(notes.join(' '));
  }

  function startEdit(ev: EventRow) {
    setEditingId(ev.id);
    setEditTitle(ev.title);
    setEditLocation(ev.location ?? '');
    setEditStartTime(toDatetimeLocal(ev.start_time));
    setEditHomeTeamId(ev.home_team_id ?? '');
    setEditAwayTeamId(ev.away_team_id ?? '');
    setEditWeekNumber(ev.week_number != null ? String(ev.week_number) : '');
  }

  function cancelEdit() {
    setEditingId(null);
  }

  async function handleSaveEdit(eventId: string) {
    setError(null);
    setSavingEdit(true);
    try {
      const weekNumberNum = editWeekNumber.trim() === '' ? null : Number(editWeekNumber);
      const result = await updateEvent({
        organizationId,
        eventId,
        title: editTitle,
        location: editLocation || null,
        startTime: new Date(editStartTime).toISOString(),
        homeTeamId: editHomeTeamId || null,
        awayTeamId: editAwayTeamId || null,
        weekNumber: Number.isFinite(weekNumberNum as number) ? weekNumberNum : null,
      });
      if ('error' in result) {
        setError(result.error);
        return;
      }
      setEvents((prev) =>
        prev
          .map((ev) =>
            ev.id === eventId
              ? {
                  ...ev,
                  title: editTitle,
                  location: editLocation || null,
                  start_time: new Date(editStartTime).toISOString(),
                  home_team_id: editHomeTeamId || null,
                  away_team_id: editAwayTeamId || null,
                  week_number: weekNumberNum,
                }
              : ev
          )
          .sort((a, b) => a.start_time.localeCompare(b.start_time))
      );
      setEditingId(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSavingEdit(false);
    }
  }

  function teamName(teamId: string | null) {
    return teams.find((t) => t.id === teamId)?.name ?? '';
  }

  function renderEventRow(ev: EventRow) {
    if (editingId === ev.id) {
      return (
        <div key={ev.id} className="data-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
          <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} className="form-input" placeholder="Title" />
          <input value={editLocation} onChange={(e) => setEditLocation(e.target.value)} className="form-input" placeholder="Location" />
          <input
            type="datetime-local"
            value={editStartTime}
            onChange={(e) => setEditStartTime(e.target.value)}
            className="form-input"
          />
          {ev.type === 'game' && (
            <>
              <select value={editHomeTeamId} onChange={(e) => setEditHomeTeamId(e.target.value)} className="form-input">
                <option value="">Home team…</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <select value={editAwayTeamId} onChange={(e) => setEditAwayTeamId(e.target.value)} className="form-input">
                <option value="">Away team…</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </>
          )}
          <input
            type="number"
            value={editWeekNumber}
            onChange={(e) => setEditWeekNumber(e.target.value)}
            className="form-input"
            placeholder="Round number (optional)"
            style={{ maxWidth: 200 }}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => handleSaveEdit(ev.id)} disabled={savingEdit} className="btn-primary">
              {savingEdit ? 'Saving…' : 'Save'}
            </button>
            <button onClick={cancelEdit} className="btn-small">
              Cancel
            </button>
          </div>
        </div>
      );
    }

    return (
      <div key={ev.id} className="data-row">
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <input
            type="checkbox"
            checked={selectedIds.has(ev.id)}
            onChange={() => toggleSelected(ev.id)}
            style={{ marginTop: 4 }}
          />
          <div>
            <div className="data-row-name">
              {ev.title}
              {ev.type === 'game' && (ev.home_team_id || ev.away_team_id) && (
                <span> — {teamName(ev.home_team_id)} vs {teamName(ev.away_team_id)}</span>
              )}
            </div>
            <div className="data-row-meta">
              {new Date(ev.start_time).toLocaleString()} {ev.location && `· ${ev.location}`}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className={`status-badge ${ev.status === 'published' ? 'confirmed' : ev.status === 'canceled' ? 'canceled' : 'pending'}`}>
            {ev.status}
          </span>
          {ev.status !== 'published' && (
            <button onClick={() => handleToggleStatus(ev.id, 'published')} className="btn-small">
              Publish
            </button>
          )}
          {ev.status === 'published' && (
            <button onClick={() => handleToggleStatus(ev.id, 'draft')} className="btn-small">
              Unpublish
            </button>
          )}
          <button onClick={() => startEdit(ev)} className="btn-small">
            Edit
          </button>
          <button onClick={() => handleDelete(ev.id)} className="btn-small">
            Delete
          </button>
        </div>
      </div>
    );
  }

  const allVisibleSelected =
    filteredEvents.length > 0 && filteredEvents.every((ev) => selectedIds.has(ev.id));

  return (
    <div>
      {error && <p style={{ color: '#B23A2E', marginBottom: 12 }}>{error}</p>}

      {seasons.length === 0 ? (
        <p style={{ color: 'var(--gray)' }}>No seasons exist yet — create one first.</p>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 20, flexWrap: 'wrap' }}>
            <select
              value={selectedSeasonId}
              onChange={(e) => handleSeasonChange(e.target.value)}
              className="form-input"
              style={{ marginBottom: 0, width: 'auto' }}
            >
              {seasons.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <select
              value={selectedDivisionId}
              onChange={(e) => setSelectedDivisionId(e.target.value)}
              className="form-input"
              style={{ marginBottom: 0, width: 'auto' }}
            >
              <option value="">All divisions</option>
              {divisionsForSeason.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
            <button onClick={handlePublishAll} className="btn-small">
              Publish all drafts
            </button>
            <button onClick={handleExportGameChanger} className="btn-small">
              Export for GameChanger
            </button>
            <button onClick={() => setShowForm((s) => !s)} className="btn-small" style={{ marginLeft: 'auto' }}>
              {showForm ? 'Cancel' : '+ Add event'}
            </button>
          </div>
          <p style={{ fontSize: 12, color: 'var(--gray)', marginTop: -12, marginBottom: 20 }}>
            Export downloads a CSV of the games currently shown above (filtered by the season/division picked
            here) in the format GameChanger&apos;s Bulk Schedule Import expects. Team names must already match
            your GameChanger organization&apos;s roster exactly.
          </p>

          {showForm && (
            <form onSubmit={handleCreate} className="form-card" style={{ marginBottom: 24 }}>
              <select value={type} onChange={(e) => setType(e.target.value as any)} className="form-input">
                {EVENT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
              <input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} className="form-input" required />
              <input placeholder="Location" value={location} onChange={(e) => setLocation(e.target.value)} className="form-input" />
              <input
                type="datetime-local"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="form-input"
                required
              />

              {type === 'game' && (
                <>
                  <select value={homeTeamId} onChange={(e) => setHomeTeamId(e.target.value)} className="form-input">
                    <option value="">Home team…</option>
                    {teams.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                  <select value={awayTeamId} onChange={(e) => setAwayTeamId(e.target.value)} className="form-input">
                    <option value="">Away team…</option>
                    {teams.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </>
              )}

              <button type="submit" disabled={submitting} className="btn-primary" style={{ width: '100%' }}>
                {submitting ? 'Adding…' : 'Add event'}
              </button>
            </form>
          )}

          {filteredEvents.length === 0 && <p style={{ color: 'var(--gray)' }}>No events yet.</p>}
          {filteredEvents.length > 0 && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--gray)' }}>
                  <input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectAllVisible} />
                  Select all shown
                </label>
                {selectedIds.size > 0 && (
                  <button onClick={handleBulkDelete} disabled={bulkDeleting} className="btn-small">
                    {bulkDeleting ? 'Deleting…' : `Delete selected (${selectedIds.size})`}
                  </button>
                )}
              </div>

              {sortedWeekKeys.map((weekKey) => (
                <div key={weekKey ?? 'unscheduled'} style={{ marginBottom: 20 }}>
                  <h3 style={{ fontSize: 14, color: 'var(--gray)', marginBottom: 8 }}>
                    {weekKey === null ? 'Unscheduled / manually added' : `Round ${weekKey}`}
                  </h3>
                  <div className="data-table-card">{weekGroups.get(weekKey)!.map((ev) => renderEventRow(ev))}</div>
                </div>
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}
