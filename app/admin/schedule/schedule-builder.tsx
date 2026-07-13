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
    <div style={{ maxWidth: 800, margin: '40px auto', fontFamily: 'system-ui', padding: '0 20px' }}>
      <h1>{organizationName} — Schedule</h1>

      {error && <p style={{ color: 'red' }}>{error}</p>}

      {seasons.length === 0 ? (
        <p style={{ color: '#666' }}>No seasons exist yet — create one first.</p>
      ) : (
        <>
          <div style={{ marginBottom: 16 }}>
            <label>
              Season:{' '}
              <select value={selectedSeasonId} onChange={(e) => setSelectedSeasonId(e.target.value)}>
                {seasons.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <button onClick={handlePublishAll} style={{ marginLeft: 12 }}>
              Publish all draft events for this season
            </button>
          </div>

          <form onSubmit={handleCreate} style={{ border: '1px solid #ddd', borderRadius: 8, padding: 16, marginBottom: 24 }}>
            <h3 style={{ marginTop: 0 }}>Add event</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <select value={type} onChange={(e) => setType(e.target.value as any)}>
                {EVENT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
              <input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} required />
              <input placeholder="Location" value={location} onChange={(e) => setLocation(e.target.value)} />
              <input
                type="datetime-local"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                required
              />

              {type === 'game' && (
                <>
                  <select value={homeTeamId} onChange={(e) => setHomeTeamId(e.target.value)}>
                    <option value="">Home team…</option>
                    {teams.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                  <select value={awayTeamId} onChange={(e) => setAwayTeamId(e.target.value)}>
                    <option value="">Away team…</option>
                    {teams.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </>
              )}

              <button type="submit" disabled={submitting}>
                {submitting ? 'Adding…' : 'Add event'}
              </button>
            </div>
          </form>

          <h3>Events</h3>
          {events.length === 0 && <p style={{ color: '#666' }}>No events yet.</p>}
          {events.map((ev) => (
            <div
              key={ev.id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '8px 0',
                borderBottom: '1px solid #eee',
              }}
            >
              <div>
                <strong>{ev.title}</strong>{' '}
                <span style={{ fontSize: 13, color: '#999' }}>({ev.type})</span>
                {ev.type === 'game' && (ev.home_team_id || ev.away_team_id) && (
                  <div style={{ fontSize: 13, color: '#666' }}>
                    {teamName(ev.home_team_id)} vs {teamName(ev.away_team_id)}
                  </div>
                )}
                <div style={{ fontSize: 13, color: '#666' }}>
                  {new Date(ev.start_time).toLocaleString()} {ev.location && `· ${ev.location}`}
                </div>
                <span
                  style={{
                    fontSize: 12,
                    color: ev.status === 'published' ? 'green' : ev.status === 'canceled' ? 'red' : '#b8860b',
                  }}
                >
                  {ev.status}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {ev.status !== 'published' && (
                  <button onClick={() => handleToggleStatus(ev.id, 'published')} style={{ fontSize: 12 }}>
                    Publish
                  </button>
                )}
                {ev.status === 'published' && (
                  <button onClick={() => handleToggleStatus(ev.id, 'draft')} style={{ fontSize: 12 }}>
                    Unpublish
                  </button>
                )}
                <button onClick={() => handleDelete(ev.id)} style={{ fontSize: 12, color: '#a00' }}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}