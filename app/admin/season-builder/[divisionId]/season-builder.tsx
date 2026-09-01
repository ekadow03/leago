// app/admin/season-builder/[divisionId]/season-builder.tsx
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { bulkCreateTeams } from '@/lib/actions/team-import';
import { generateSeasonSchedule } from '@/lib/actions/auto-schedule';

interface Team {
  id: string;
  name: string;
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function SeasonBuilder({
  organizationId,
  seasonId,
  divisionId,
  divisionName,
  initialTeams,
  existingGameCount,
}: {
  organizationId: string;
  seasonId: string;
  divisionId: string;
  divisionName: string;
  initialTeams: Team[];
  existingGameCount: number;
}) {
  const [teams, setTeams] = useState(initialTeams);

  return (
    <div>
      <TeamImport divisionId={divisionId} organizationId={organizationId} teams={teams} setTeams={setTeams} />
      <ScheduleGenerator
        organizationId={organizationId}
        seasonId={seasonId}
        divisionId={divisionId}
        divisionName={divisionName}
        teamCount={teams.length}
        existingGameCount={existingGameCount}
      />
    </div>
  );
}

function downloadCsvTemplate() {
  const csv = 'team_name\nRed Sox\nBlue Jays\nYankees\n';
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'team-template.csv';
  a.click();
  URL.revokeObjectURL(url);
}

function TeamImport({
  divisionId,
  organizationId,
  teams,
  setTeams,
}: {
  divisionId: string;
  organizationId: string;
  teams: Team[];
  setTeams: React.Dispatch<React.SetStateAction<Team[]>>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setError(null);

    try {
      const text = await file.text();
      // Simple CSV parse — single column ("team_name"), one name per line.
      // Skips a header row if the first line looks like "team_name".
      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const dataLines =
        lines[0]?.toLowerCase().includes('team') ? lines.slice(1) : lines;

      if (dataLines.length === 0) {
        throw new Error('No team names found in that file.');
      }

      const result = await bulkCreateTeams(organizationId, divisionId, dataLines);
      if ('error' in result) {
        throw new Error(result.error);
      }
      // Re-derive the new list is simplest via a light reload of just the
      // names we just sent — real IDs will show correctly after a page
      // refresh, but this keeps the UI responsive immediately.
      setTeams((prev) => [
        ...prev,
        ...dataLines.map((name) => ({ id: `pending-${name}`, name })),
      ]);
      alert(`Imported ${result.count} team(s).`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  return (
    <div className="form-card" style={{ marginBottom: 32 }}>
      <h2>Teams ({teams.length})</h2>

      {teams.length > 0 && (
        <div className="chip-list">
          {teams.map((t) => (
            <span key={t.id} className="chip">{t.name}</span>
          ))}
        </div>
      )}

      {error && <p style={{ color: '#B23A2E', fontSize: 14 }}>{error}</p>}

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <button onClick={downloadCsvTemplate} className="btn-small">
          Download CSV template
        </button>
        <label style={{ cursor: 'pointer' }}>
          <span className="btn-small" style={{ display: 'inline-block' }}>
            {uploading ? 'Importing…' : 'Upload teams CSV'}
          </span>
          <input type="file" accept=".csv" onChange={handleFileChange} disabled={uploading} style={{ display: 'none' }} />
        </label>
      </div>
    </div>
  );
}

function ScheduleGenerator({
  organizationId,
  seasonId,
  divisionId,
  divisionName,
  teamCount,
  existingGameCount,
}: {
  organizationId: string;
  seasonId: string;
  divisionId: string;
  divisionName: string;
  teamCount: number;
  existingGameCount: number;
}) {
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>([]);
  const [times, setTimes] = useState<string[]>([]);
  const [newTime, setNewTime] = useState('18:00');
  const [fields, setFields] = useState<string[]>([]);
  const [newField, setNewField] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ gamesCreated: number; seasonDatesUsed: number } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function toggleDay(day: number) {
    setDaysOfWeek((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort()));
  }

  function addTime() {
    if (newTime && !times.includes(newTime)) {
      setTimes((prev) => [...prev, newTime].sort());
    }
  }

  function addField() {
    const trimmed = newField.trim();
    if (trimmed && !fields.includes(trimmed)) {
      setFields((prev) => [...prev, trimmed]);
      setNewField('');
    }
  }

  function formatTime12h(t: string): string {
    const [h, m] = t.split(':').map(Number);
    const period = h >= 12 ? 'PM' : 'AM';
    const hour12 = h % 12 === 0 ? 12 : h % 12;
    return `${hour12}:${m.toString().padStart(2, '0')} ${period}`;
  }

  async function handleGenerate() {
    setSubmitting(true);
    setError(null);
    setResult(null);
    try {
      const res = await generateSeasonSchedule({
        organizationId,
        seasonId,
        divisionId,
        daysOfWeek,
        times,
        fields,
        startDate,
        endDate,
      });
      if ('error' in res) {
        setError(res.error);
        return;
      }
      setResult(res);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  const canGenerate = teamCount >= 2 && daysOfWeek.length > 0 && times.length > 0 && fields.length > 0 && startDate && endDate;

  return (
    <div className="form-card">
      <h2>Generate season schedule</h2>
      <p style={{ fontSize: 13, color: 'var(--gray)', marginTop: -12, marginBottom: 16 }}>
        Builds a fair round-robin and repeats it across your whole season, so every team plays a roughly equal
        number of games. Games are created as drafts — review and publish them from the{' '}
        <Link href="/admin/schedule" style={{ color: 'var(--green-dark)' }}>Schedule</Link> page when ready.
      </p>

      {existingGameCount > 0 && (
        <p style={{ fontSize: 13, color: '#92660B', background: 'rgba(232,185,61,0.15)', padding: '8px 12px', borderRadius: 8, marginBottom: 16 }}>
          This division already has {existingGameCount} game(s) scheduled. Generating again will ADD more games
          alongside them, not replace them.
        </p>
      )}

      <label className="form-label">Game days</label>
      <div className="day-grid">
        {DAY_LABELS.map((label, i) => (
          <button
            key={label}
            type="button"
            onClick={() => toggleDay(i)}
            className={`day-toggle ${daysOfWeek.includes(i) ? 'active' : ''}`}
          >
            {label}
          </button>
        ))}
      </div>

      <label className="form-label">Time slots</label>
      {times.length > 0 && (
        <div className="chip-list">
          {times.map((t) => (
            <span key={t} className="chip">
              {formatTime12h(t)}
              <button onClick={() => setTimes((prev) => prev.filter((x) => x !== t))}>×</button>
            </span>
          ))}
        </div>
      )}
      <div className="add-chip-row">
        <input type="time" value={newTime} onChange={(e) => setNewTime(e.target.value)} className="form-input" style={{ width: 140 }} />
        <button onClick={addTime} className="btn-small">+ Add time</button>
      </div>

      <label className="form-label">Fields</label>
      {fields.length > 0 && (
        <div className="chip-list">
          {fields.map((f) => (
            <span key={f} className="chip">
              {f}
              <button onClick={() => setFields((prev) => prev.filter((x) => x !== f))}>×</button>
            </span>
          ))}
        </div>
      )}
      <div className="add-chip-row">
        <input
          value={newField}
          onChange={(e) => setNewField(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addField())}
          className="form-input"
          placeholder="e.g. Field 1"
        />
        <button onClick={addField} className="btn-small">+ Add field</button>
      </div>

      <label className="form-label">Season start date</label>
      <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="form-input" />

      <label className="form-label">Season end date</label>
      <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="form-input" />

      {error && <p style={{ color: '#B23A2E', fontSize: 14 }}>{error}</p>}
      {result && (
        <p style={{ color: 'var(--green-dark)', fontSize: 14, fontWeight: 600 }}>
          Created {result.gamesCreated} games across {result.seasonDatesUsed} game dates.
        </p>
      )}

      <button onClick={handleGenerate} disabled={!canGenerate || submitting} className="btn-primary" style={{ width: '100%' }}>
        {submitting ? 'Generating…' : `Generate schedule for ${divisionName}`}
      </button>
      {!canGenerate && (
        <p style={{ fontSize: 12, color: 'var(--gray)', marginTop: 8 }}>
          Need at least 2 teams, one game day, one time, one field, and both dates set.
        </p>
      )}
    </div>
  );
}
