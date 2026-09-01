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
            <button onClick={() => setShowForm((s) => !s)} className="btn-small" style={{ marginLeft: 'auto' }}>
              {showForm ? 'Cancel' : '+ Add event'}
            </button>
          </div>

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
