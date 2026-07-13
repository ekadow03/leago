// app/admin/schedule/schedule-builder.tsx
'use client';

import { useState } from 'react';
import { createEvent, setEventStatus, publishAllDraftEvents, deleteEvent } from '@/lib/actions/events';

interface Season {
  id: string;
  name: string;
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
  home_team_id: string | null;
  away_team_id: string | null;
}

const EVENT_TYPES = [
  { value: 'game', label: 'Game' },
  { value: 'practice', label: 'Practice' },
  { value: 'volunteer_shift', label: 'Volunteer Shift' },
  { value: 'league_event', label: 'League Event' },
] as const;

export default function ScheduleBuilder({
  organizationId,
  organizationName,
  seasons,
  teams,
  initialEvents,
}: {
  organizationId: string;
  organizationName: string;
  seasons: Season[];
  teams: Team[];
  initialEvents: EventRow[];
}) {
  const [events, setEvents] = useState(initialEvents);
  const [error, setError] = useState<string | null>(null);
  const [selectedSeasonId, setSelectedSeasonId] = useState(seasons[0]?.id ?? '');

  const [type, setType] = useState<'game' | 'practice' | 'volunteer_shift' | 'league_event'>('game');
  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [startTime, setStartTime] = useState('');
  const [homeTeamId, setHomeTeamId] = useState('');
  const [awayTeamId, setAwayTeamId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showForm, setShowForm] = useState(false);

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
          home_team_id: homeTeamId || null,
          away_team_id: awayTeamId || null,
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
      await setEventStatus(organizationId, eventId, newStatus);
      setEvents((prev) => prev.map((ev) => (ev.id === eventId ? { ...ev, status: newStatus } : ev)));
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleDelete(eventId: string) {
    if (!confirm('Delete this event?')) return;
    setError(null);
    try {
      await deleteEvent(organizationId, eventId);
      setEvents((prev) => prev.filter((ev) => ev.id !== eventId));
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handlePublishAll() {
    if (!selectedSeasonId) return;
    setError(null);
    try {
      const result = await publishAllDraftEvents(organizationId, selectedSeasonId);
      setEvents((prev) =>
        prev.map((ev) => (ev.season_id === selectedSeasonId && ev.status === 'draft' ? { ...ev, status: 'published' } : ev))
      );
      alert(`Published ${result.count} event(s).`);
    } catch (err: any) {
      setError(err.message);
    }
  }

  function teamName(teamId: string | null) {
    return teams.find((t) => t.id === teamId)?.name ?? '';
  }

  return (
    <div>
      {error && <p style={{ color: '#B23A2E', marginBottom: 12 }}>{error}</p>}

      {seasons.length === 0 ? (
        <p style={{ color: 'var(--gray)' }}>No seasons exist yet — create one first.</p>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 20 }}>
            <select value={selectedSeasonId} onChange={(e) => setSelectedSeasonId(e.target.value)} className="form-input" style={{ marginBottom: 0, width: 'auto' }}>
              {seasons.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
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

          {events.length === 0 && <p style={{ color: 'var(--gray)' }}>No events yet.</p>}
          {events.length > 0 && (
            <div className="data-table-card">
              {events.map((ev) => (
                <div key={ev.id} className="data-row">
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
                    <button onClick={() => handleDelete(ev.id)} className="btn-small">
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
