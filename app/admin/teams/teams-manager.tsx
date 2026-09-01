// app/admin/teams/teams-manager.tsx
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createTeam } from '@/lib/actions/teams';
import { bulkCreateTeams } from '@/lib/actions/team-import';

interface Season {
  id: string;
  name: string;
}

interface Division {
  id: string;
  season_id: string;
  name: string;
}

interface Team {
  id: string;
  name: string;
  division_id: string;
}

// Minimal CSV row parser — handles a plain comma split for the common
// case, and double-quoted fields (with "" as an escaped quote inside
// one) for the rare team/division name that contains a comma.
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields.map((f) => f.trim());
}

function csvField(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows.map((row) => row.map(csvField).join(',')).join('\n') + '\n';
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function TeamsManager({
  organizationId,
  seasons,
  divisions,
  initialTeams,
}: {
  organizationId: string;
  seasons: Season[];
  divisions: Division[];
  initialTeams: Team[];
}) {
  const [teams, setTeams] = useState(initialTeams);
  const [selectedSeasonId, setSelectedSeasonId] = useState(seasons[0]?.id ?? '');

  const divisionsForSeason = divisions.filter((d) => d.season_id === selectedSeasonId);

  function handleTeamAdded(team: Team) {
    setTeams((prev) => [...prev, team]);
  }

  function handleTeamsImported(newTeams: Team[]) {
    setTeams((prev) => [...prev, ...newTeams]);
  }

  if (seasons.length === 0) {
    return <p style={{ color: 'var(--gray)' }}>No seasons exist yet — create one from the Dashboard first.</p>;
  }

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <label className="form-label">Season</label>
        <select
          value={selectedSeasonId}
          onChange={(e) => setSelectedSeasonId(e.target.value)}
          className="form-input"
          style={{ width: 'auto' }}
        >
          {seasons.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      {divisionsForSeason.length === 0 ? (
        <p style={{ color: 'var(--gray)' }}>
          No divisions in this season yet — add one from the{' '}
          <Link href="/admin" style={{ color: 'var(--green-dark)' }}>
            Dashboard
          </Link>{' '}
          first.
        </p>
      ) : (
        <>
          <BulkImportPanel
            organizationId={organizationId}
            divisionsForSeason={divisionsForSeason}
            onImported={handleTeamsImported}
          />

          {divisionsForSeason.map((d) => (
            <DivisionTeamsCard
              key={d.id}
              organizationId={organizationId}
              division={d}
              teams={teams.filter((t) => t.division_id === d.id)}
              onTeamAdded={handleTeamAdded}
            />
          ))}
        </>
      )}
    </div>
  );
}

function BulkImportPanel({
  organizationId,
  divisionsForSeason,
  onImported,
}: {
  organizationId: string;
  divisionsForSeason: Division[];
  onImported: (teams: Team[]) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);

  // One column per division (its name is the header), one team name per
  // row underneath its division's column — divisions with fewer teams
  // just leave the rest of that column blank, since the number of teams
  // rarely matches across divisions.
  function handleDownloadTemplate() {
    const columns = divisionsForSeason.length > 0 ? divisionsForSeason.map((d) => d.name) : ['10U', '12U'];
    const sampleNames = ['Red Sox', 'Blue Jays', 'Eagles', 'Wildcats'];
    const rows: string[][] = [columns];
    rows.push(columns.map((_, i) => sampleNames[i] ?? 'Team Name'));
    rows.push(columns.map((_, i) => (i === 0 ? 'Yankees' : '')));
    downloadCsv('team-template.csv', rows);
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setError(null);
    setSummary(null);

    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (lines.length === 0) {
        throw new Error('That file is empty.');
      }

      const header = parseCsvLine(lines[0]);
      if (header.length === 0 || header.every((h) => !h.trim())) {
        throw new Error('The CSV needs a division name in each column header — download the template for the exact format.');
      }

      const rows = lines.slice(1).map(parseCsvLine);

      // Each COLUMN is a division (matched by header name, case/whitespace
      // insensitive, against this SEASON's real divisions — matching by
      // name only within one season avoids ambiguity if two different
      // seasons happen to reuse a division name like "10U"). Every
      // non-blank cell below it, down every row, is one team name for
      // that division — columns don't need the same number of filled-in
      // rows, since divisions rarely have the same team count.
      const columnDivisions = header.map((name) =>
        divisionsForSeason.find((d) => d.name.toLowerCase() === name.trim().toLowerCase())
      );

      const namesByDivisionId = new Map<string, string[]>();
      const unmatched = new Set<string>();

      header.forEach((name, colIdx) => {
        if (!name.trim()) return;
        if (!columnDivisions[colIdx]) unmatched.add(name.trim());
      });

      for (const row of rows) {
        header.forEach((_, colIdx) => {
          const division = columnDivisions[colIdx];
          if (!division) return;
          const teamName = (row[colIdx] ?? '').trim();
          if (!teamName) return;

          const list = namesByDivisionId.get(division.id) ?? [];
          list.push(teamName);
          namesByDivisionId.set(division.id, list);
        });
      }

      if (namesByDivisionId.size === 0) {
        throw new Error(
          unmatched.size > 0
            ? `No columns matched a division in this season. Unrecognized column header(s): ${Array.from(unmatched).join(', ')}.`
            : 'No valid rows found in that file.'
        );
      }

      const createdTeams: Team[] = [];
      const failures: string[] = [];
      let totalCreated = 0;

      for (const [divisionId, names] of namesByDivisionId) {
        const result = await bulkCreateTeams(organizationId, divisionId, names);
        if ('error' in result) {
          const divisionName = divisionsForSeason.find((d) => d.id === divisionId)?.name ?? divisionId;
          failures.push(`${divisionName}: ${result.error}`);
          continue;
        }
        totalCreated += result.count;
        // Placeholder ids — the real ones show up after a page refresh,
        // same tradeoff the old per-division importer made for a
        // responsive UI without a second round-trip just to re-fetch ids.
        names.forEach((name) => createdTeams.push({ id: `pending-${divisionId}-${name}`, name, division_id: divisionId }));
      }

      onImported(createdTeams);

      const parts = [`Imported ${totalCreated} team(s).`];
      if (unmatched.size > 0) parts.push(`Skipped unrecognized column(s): ${Array.from(unmatched).join(', ')}.`);
      if (failures.length > 0) parts.push(`Errors: ${failures.join('; ')}`);
      setSummary(parts.join(' '));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  return (
    <div className="form-card" style={{ marginBottom: 24 }}>
      <h2 style={{ margin: 0 }}>Bulk import</h2>
      <p style={{ fontSize: 13, color: 'var(--gray)', marginTop: 4, marginBottom: 12 }}>
        Download the template for this season (one column per division, pre-filled with its actual division
        names), list each division&apos;s team names down its column, and upload it back — teams get sorted into
        the right division automatically. Columns don&apos;t need to line up in length; leave the rest of a
        shorter division&apos;s column blank.
      </p>

      {error && <p style={{ color: '#B23A2E', fontSize: 14 }}>{error}</p>}
      {summary && <p style={{ color: 'var(--green-dark)', fontSize: 14 }}>{summary}</p>}

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <button onClick={handleDownloadTemplate} className="btn-small">
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

function DivisionTeamsCard({
  organizationId,
  division,
  teams,
  onTeamAdded,
}: {
  organizationId: string;
  division: Division;
  teams: Team[];
  onTeamAdded: (team: Team) => void;
}) {
  const [newTeamName, setNewTeamName] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setAdding(true);
    setError(null);
    try {
      const result = await createTeam(organizationId, division.id, newTeamName);
      if ('error' in result) {
        setError(result.error);
        return;
      }
      onTeamAdded({ id: result.id, name: result.name, division_id: division.id });
      setNewTeamName('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="form-card" style={{ marginBottom: 20 }}>
      <h2 style={{ margin: 0 }}>
        {division.name} ({teams.length})
      </h2>

      {teams.length > 0 && (
        <div className="chip-list" style={{ marginTop: 12 }}>
          {teams.map((t) => (
            <span key={t.id} className="chip">
              {t.name}
            </span>
          ))}
        </div>
      )}

      {error && <p style={{ color: '#B23A2E', fontSize: 14 }}>{error}</p>}

      <form onSubmit={handleAdd} className="add-chip-row" style={{ marginTop: 12 }}>
        <input
          value={newTeamName}
          onChange={(e) => setNewTeamName(e.target.value)}
          className="form-input"
          placeholder="Team name, e.g. Red Sox"
        />
        <button type="submit" disabled={adding || !newTeamName.trim()} className="btn-small">
          {adding ? 'Adding…' : '+ Add team'}
        </button>
      </form>
    </div>
  );
}
