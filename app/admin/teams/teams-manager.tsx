// app/admin/teams/teams-manager.tsx
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createTeam, deleteTeam, deleteAllTeamsInDivision } from '@/lib/actions/teams';
import { bulkCreateTeams } from '@/lib/actions/team-import';
import { bulkImportCoaches, type CoachImportRow, type CoachRole } from '@/lib/actions/coach-import';
import { bulkImportRoster, type RosterImportRow } from '@/lib/actions/roster-import';
import { importTeamRosterReport } from '@/lib/actions/team-roster-report-import';

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
  initialTeamStats,
}: {
  organizationId: string;
  seasons: Season[];
  divisions: Division[];
  initialTeams: Team[];
  initialTeamStats: Record<string, { players: number; coaches: number }>;
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

  function handleTeamRemoved(teamId: string) {
    setTeams((prev) => prev.filter((t) => t.id !== teamId));
  }

  function handleDivisionTeamsCleared(divisionId: string) {
    setTeams((prev) => prev.filter((t) => t.division_id !== divisionId));
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

          <RosterAndCoachImportPanel
            key={selectedSeasonId}
            organizationId={organizationId}
            divisionsForSeason={divisionsForSeason}
            teams={teams}
          />

          {divisionsForSeason.map((d) => (
            <DivisionTeamsCard
              key={d.id}
              organizationId={organizationId}
              division={d}
              teams={teams.filter((t) => t.division_id === d.id)}
              teamStats={initialTeamStats}
              onTeamAdded={handleTeamAdded}
              onTeamRemoved={handleTeamRemoved}
              onDivisionTeamsCleared={handleDivisionTeamsCleared}
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
      let totalSkipped = 0;

      for (const [divisionId, names] of namesByDivisionId) {
        const result = await bulkCreateTeams(organizationId, divisionId, names);
        if ('error' in result) {
          const divisionName = divisionsForSeason.find((d) => d.id === divisionId)?.name ?? divisionId;
          failures.push(`${divisionName}: ${result.error}`);
          continue;
        }
        totalCreated += result.teams.length;
        totalSkipped += result.skipped.length;
        result.teams.forEach((t) => createdTeams.push({ id: t.id, name: t.name, division_id: divisionId }));
      }

      onImported(createdTeams);

      const parts = [`Imported ${totalCreated} team(s).`];
      if (totalSkipped > 0) {
        parts.push(`Skipped ${totalSkipped} duplicate name(s) already in their division.`);
      }
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

function normalizeCoachRole(raw: string): CoachRole {
  const key = raw.toLowerCase().replace(/[\s_-]+/g, '');
  if (key === 'assistantcoach' || key === 'assistant') return 'assistant_coach';
  if (key === 'volunteer') return 'volunteer';
  return 'head_coach'; // default — covers "Head Coach", "Coach", blank, or anything unrecognized
}

// Looks up a column by header name (case-insensitive, exact match after
// trimming) — used by both the coach and roster importers below so a
// reordered or partially-filled-out CSV header still works.
function columnIndex(header: string[], name: string): number {
  return header.findIndex((h) => h.trim().toLowerCase() === name);
}

function TeamRosterReportImportSection({
  organizationId,
  divisionId,
}: {
  organizationId: string;
  divisionId: string;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!divisionId) {
      setError('Pick a division first.');
      e.target.value = '';
      return;
    }

    setUploading(true);
    setError(null);
    setSummary(null);

    try {
      const formData = new FormData();
      formData.set('file', file);

      const result = await importTeamRosterReport(organizationId, divisionId, formData);
      if ('error' in result) {
        setError(result.error);
        return;
      }

      const { coachResult, rosterResult, unmatchedTeamNames } = result;
      const parts = [
        `Added ${rosterResult.registered} player${rosterResult.registered === 1 ? '' : 's'} and ${coachResult.staffed} coach/staff assignment${
          coachResult.staffed === 1 ? '' : 's'
        }${
          rosterResult.peopleCreated + coachResult.peopleCreated > 0
            ? ` (${rosterResult.peopleCreated + coachResult.peopleCreated} new person record${
                rosterResult.peopleCreated + coachResult.peopleCreated === 1 ? '' : 's'
              } created)`
            : ''
        }.`,
      ];
      if (rosterResult.skipped > 0) parts.push(`Skipped ${rosterResult.skipped} player${rosterResult.skipped === 1 ? '' : 's'} already registered this season.`);
      if (coachResult.skipped > 0) parts.push(`Skipped ${coachResult.skipped} staff assignment${coachResult.skipped === 1 ? '' : 's'} already on that team.`);
      if (unmatchedTeamNames.length > 0) {
        parts.push(`Skipped team(s) not found in this division: ${unmatchedTeamNames.join(', ')}.`);
      }
      setSummary(parts.join(' '));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  return (
    <div>
      <h3 style={{ fontSize: 14, marginBottom: 4 }}>Team Roster Report (.xlsx)</h3>
      <p style={{ fontSize: 12, color: 'var(--gray)', marginBottom: 10 }}>
        Upload the &quot;Team Roster Report&quot; export as-is — players and team personnel for every team in
        this division are read straight from the file and matched to teams by name. A player&apos;s parent/
        guardian contact from the report is kept as who submitted their registration, not attached to the
        player&apos;s own record. &quot;Team Manager&quot; is imported as head coach, &quot;Assistant Coach&quot;
        as assistant coach, and other roles (Score Keeper, Team Parent, etc.) as volunteers.
      </p>
      {error && <p style={{ color: '#B23A2E', fontSize: 13 }}>{error}</p>}
      {summary && <p style={{ color: 'var(--green-dark)', fontSize: 13 }}>{summary}</p>}
      <label style={{ cursor: 'pointer' }}>
        <span className="btn-small" style={{ display: 'inline-block' }}>
          {uploading ? 'Importing…' : 'Upload Team Roster Report'}
        </span>
        <input
          type="file"
          accept=".xlsx"
          onChange={handleFileChange}
          disabled={uploading || !divisionId}
          style={{ display: 'none' }}
        />
      </label>
    </div>
  );
}

function RosterAndCoachImportPanel({
  organizationId,
  divisionsForSeason,
  teams,
}: {
  organizationId: string;
  divisionsForSeason: Division[];
  teams: Team[];
}) {
  const [divisionId, setDivisionId] = useState(divisionsForSeason[0]?.id ?? '');

  const divisionTeams = teams.filter((t) => t.division_id === divisionId);

  return (
    <div className="form-card" style={{ marginBottom: 24 }}>
      <h2 style={{ margin: 0 }}>Rosters &amp; coaches</h2>
      <p style={{ fontSize: 13, color: 'var(--gray)', marginTop: 4, marginBottom: 12 }}>
        Bulk-add players and coaches to one division&apos;s teams — for backfilling a roster you already have
        elsewhere, rather than sending everyone through registration and the draft. Someone who isn&apos;t a
        leago account yet gets a placeholder record created automatically; including an email lets them claim
        it later just by signing up with that same address (and keeps a re-upload from creating a duplicate).
      </p>

      <div style={{ marginBottom: 16 }}>
        <label className="form-label">Division</label>
        <select value={divisionId} onChange={(e) => setDivisionId(e.target.value)} className="form-input" style={{ width: 'auto' }}>
          {divisionsForSeason.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </div>

      <TeamRosterReportImportSection organizationId={organizationId} divisionId={divisionId} />

      <div style={{ borderTop: '1px solid var(--border)', margin: '20px 0', paddingTop: 16 }}>
        <p style={{ fontSize: 12, color: 'var(--gray)', marginTop: 0, marginBottom: 12 }}>
          Or, if your roster isn&apos;t in that format, use these plain CSV templates instead:
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 20 }}>
          <CoachImportSection organizationId={organizationId} divisionId={divisionId} divisionTeams={divisionTeams} />
          <RosterImportSection organizationId={organizationId} divisionId={divisionId} divisionTeams={divisionTeams} />
        </div>
      </div>
    </div>
  );
}

function CoachImportSection({
  organizationId,
  divisionId,
  divisionTeams,
}: {
  organizationId: string;
  divisionId: string;
  divisionTeams: Team[];
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);

  function handleDownloadTemplate() {
    const team1 = divisionTeams[0]?.name ?? 'Red Sox';
    const team2 = divisionTeams[1]?.name ?? team1;
    downloadCsv('coaches-template.csv', [
      ['Team', 'First Name', 'Last Name', 'Email', 'Role'],
      [team1, 'Jamie', 'Rivera', 'jamie.rivera@example.com', 'Head Coach'],
      [team2, 'Sam', 'Okafor', '', 'Assistant Coach'],
    ]);
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!divisionId) {
      setError('Pick a division first.');
      e.target.value = '';
      return;
    }

    setUploading(true);
    setError(null);
    setSummary(null);

    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (lines.length < 2) {
        throw new Error('That file has no data rows — download the template for the exact format.');
      }

      const header = parseCsvLine(lines[0]);
      const idx = {
        team: columnIndex(header, 'team'),
        first: columnIndex(header, 'first name'),
        last: columnIndex(header, 'last name'),
        email: columnIndex(header, 'email'),
        role: columnIndex(header, 'role'),
      };
      if (idx.team === -1 || idx.first === -1 || idx.last === -1) {
        throw new Error('The CSV needs at least Team, First Name, and Last Name columns — download the template for the exact format.');
      }

      const rows: CoachImportRow[] = [];
      const unmatchedTeams = new Set<string>();

      for (const cols of lines.slice(1).map(parseCsvLine)) {
        const teamName = (cols[idx.team] ?? '').trim();
        const firstName = (cols[idx.first] ?? '').trim();
        const lastName = (cols[idx.last] ?? '').trim();
        if (!teamName && !firstName && !lastName) continue;

        const team = divisionTeams.find((t) => t.name.toLowerCase() === teamName.toLowerCase());
        if (!team) {
          if (teamName) unmatchedTeams.add(teamName);
          continue;
        }
        if (!firstName || !lastName) continue;

        rows.push({
          teamId: team.id,
          firstName,
          lastName,
          email: idx.email !== -1 ? (cols[idx.email] ?? '').trim() : '',
          role: normalizeCoachRole(idx.role !== -1 ? (cols[idx.role] ?? '').trim() : ''),
        });
      }

      if (rows.length === 0) {
        throw new Error(
          unmatchedTeams.size > 0
            ? `No rows matched a team in this division. Unrecognized team name(s): ${Array.from(unmatchedTeams).join(', ')}.`
            : 'No valid rows found in that file.'
        );
      }

      const result = await bulkImportCoaches(organizationId, divisionId, rows);
      if ('error' in result) {
        setError(result.error);
        return;
      }

      const parts = [
        `Added ${result.staffed} coach/staff assignment${result.staffed === 1 ? '' : 's'}${
          result.peopleCreated > 0 ? ` (${result.peopleCreated} new person record${result.peopleCreated === 1 ? '' : 's'} created)` : ''
        }.`,
      ];
      if (result.skipped > 0) parts.push(`Skipped ${result.skipped} already on that team.`);
      if (unmatchedTeams.size > 0) parts.push(`Skipped unrecognized team name(s): ${Array.from(unmatchedTeams).join(', ')}.`);
      setSummary(parts.join(' '));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  return (
    <div>
      <h3 style={{ fontSize: 14, marginBottom: 4 }}>Coaches</h3>
      <p style={{ fontSize: 12, color: 'var(--gray)', marginBottom: 10 }}>
        Columns: Team, First Name, Last Name, Email (optional), Role (Head Coach / Assistant Coach / Volunteer —
        defaults to Head Coach if left blank).
      </p>
      {error && <p style={{ color: '#B23A2E', fontSize: 13 }}>{error}</p>}
      {summary && <p style={{ color: 'var(--green-dark)', fontSize: 13 }}>{summary}</p>}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <button onClick={handleDownloadTemplate} className="btn-small">
          Download template
        </button>
        <label style={{ cursor: 'pointer' }}>
          <span className="btn-small" style={{ display: 'inline-block' }}>
            {uploading ? 'Importing…' : 'Upload coaches CSV'}
          </span>
          <input type="file" accept=".csv" onChange={handleFileChange} disabled={uploading || !divisionId} style={{ display: 'none' }} />
        </label>
      </div>
    </div>
  );
}

function RosterImportSection({
  organizationId,
  divisionId,
  divisionTeams,
}: {
  organizationId: string;
  divisionId: string;
  divisionTeams: Team[];
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);

  function handleDownloadTemplate() {
    const team1 = divisionTeams[0]?.name ?? 'Red Sox';
    downloadCsv('roster-template.csv', [
      ['Team', 'First Name', 'Last Name', 'Jersey Number', 'Email'],
      [team1, 'Avery', 'Chen', '7', ''],
      [team1, 'Jordan', 'Patel', '14', ''],
    ]);
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!divisionId) {
      setError('Pick a division first.');
      e.target.value = '';
      return;
    }

    setUploading(true);
    setError(null);
    setSummary(null);

    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (lines.length < 2) {
        throw new Error('That file has no data rows — download the template for the exact format.');
      }

      const header = parseCsvLine(lines[0]);
      const idx = {
        team: columnIndex(header, 'team'),
        first: columnIndex(header, 'first name'),
        last: columnIndex(header, 'last name'),
        jersey: columnIndex(header, 'jersey number'),
        email: columnIndex(header, 'email'),
      };
      if (idx.team === -1 || idx.first === -1 || idx.last === -1) {
        throw new Error('The CSV needs at least Team, First Name, and Last Name columns — download the template for the exact format.');
      }

      const rows: RosterImportRow[] = [];
      const unmatchedTeams = new Set<string>();

      for (const cols of lines.slice(1).map(parseCsvLine)) {
        const teamName = (cols[idx.team] ?? '').trim();
        const firstName = (cols[idx.first] ?? '').trim();
        const lastName = (cols[idx.last] ?? '').trim();
        if (!teamName && !firstName && !lastName) continue;

        const team = divisionTeams.find((t) => t.name.toLowerCase() === teamName.toLowerCase());
        if (!team) {
          if (teamName) unmatchedTeams.add(teamName);
          continue;
        }
        if (!firstName || !lastName) continue;

        rows.push({
          teamId: team.id,
          firstName,
          lastName,
          jerseyNumber: idx.jersey !== -1 ? (cols[idx.jersey] ?? '').trim() : '',
          email: idx.email !== -1 ? (cols[idx.email] ?? '').trim() : '',
        });
      }

      if (rows.length === 0) {
        throw new Error(
          unmatchedTeams.size > 0
            ? `No rows matched a team in this division. Unrecognized team name(s): ${Array.from(unmatchedTeams).join(', ')}.`
            : 'No valid rows found in that file.'
        );
      }

      const result = await bulkImportRoster(organizationId, divisionId, rows);
      if ('error' in result) {
        setError(result.error);
        return;
      }

      const parts = [
        `Added ${result.registered} player${result.registered === 1 ? '' : 's'}${
          result.peopleCreated > 0 ? ` (${result.peopleCreated} new person record${result.peopleCreated === 1 ? '' : 's'} created)` : ''
        }.`,
      ];
      if (result.skipped > 0) parts.push(`Skipped ${result.skipped} already registered this season.`);
      if (unmatchedTeams.size > 0) parts.push(`Skipped unrecognized team name(s): ${Array.from(unmatchedTeams).join(', ')}.`);
      setSummary(parts.join(' '));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  return (
    <div>
      <h3 style={{ fontSize: 14, marginBottom: 4 }}>Roster</h3>
      <p style={{ fontSize: 12, color: 'var(--gray)', marginBottom: 10 }}>
        Columns: Team, First Name, Last Name, Jersey Number (optional), Email (optional). Goes straight in as a
        confirmed registration for this season — this skips the normal sign-up/draft flow on purpose.
      </p>
      {error && <p style={{ color: '#B23A2E', fontSize: 13 }}>{error}</p>}
      {summary && <p style={{ color: 'var(--green-dark)', fontSize: 13 }}>{summary}</p>}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <button onClick={handleDownloadTemplate} className="btn-small">
          Download template
        </button>
        <label style={{ cursor: 'pointer' }}>
          <span className="btn-small" style={{ display: 'inline-block' }}>
            {uploading ? 'Importing…' : 'Upload roster CSV'}
          </span>
          <input type="file" accept=".csv" onChange={handleFileChange} disabled={uploading || !divisionId} style={{ display: 'none' }} />
        </label>
      </div>
    </div>
  );
}

function DivisionTeamsCard({
  organizationId,
  division,
  teams,
  teamStats,
  onTeamAdded,
  onTeamRemoved,
  onDivisionTeamsCleared,
}: {
  organizationId: string;
  division: Division;
  teams: Team[];
  teamStats: Record<string, { players: number; coaches: number }>;
  onTeamAdded: (team: Team) => void;
  onTeamRemoved: (teamId: string) => void;
  onDivisionTeamsCleared: (divisionId: string) => void;
}) {
  const router = useRouter();
  const [newTeamName, setNewTeamName] = useState('');
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
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

  async function handleRemoveTeam(team: Team) {
    if (
      !confirm(
        `Remove ${team.name}? If it's already in a generated schedule, those games will keep their date/time/field but lose this team — you'll need to reassign or regenerate.`
      )
    ) {
      return;
    }
    setRemovingId(team.id);
    setError(null);
    try {
      const result = await deleteTeam(organizationId, team.id);
      if ('error' in result) {
        setError(result.error);
        return;
      }
      onTeamRemoved(team.id);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setRemovingId(null);
    }
  }

  async function handleClearAll() {
    if (
      !confirm(
        `Remove all ${teams.length} team(s) from ${division.name}? This can't be undone, and any generated games involving them will lose those team assignments.`
      )
    ) {
      return;
    }
    setClearing(true);
    setError(null);
    try {
      const result = await deleteAllTeamsInDivision(organizationId, division.id);
      if ('error' in result) {
        setError(result.error);
        return;
      }
      onDivisionTeamsCleared(division.id);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setClearing(false);
    }
  }

  return (
    <div className="form-card" style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ margin: 0 }}>
          {division.name} ({teams.length})
        </h2>
        {teams.length > 0 && (
          <button type="button" onClick={handleClearAll} disabled={clearing} className="btn-small">
            {clearing ? 'Removing…' : 'Remove all teams'}
          </button>
        )}
      </div>

      {teams.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 12 }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
              <th style={{ padding: '6px 8px' }}>Team</th>
              <th style={{ padding: '6px 8px' }}>Players</th>
              <th style={{ padding: '6px 8px' }}>Coaches</th>
              <th style={{ padding: '6px 8px' }} />
            </tr>
          </thead>
          <tbody>
            {teams.map((t) => {
              const stats = teamStats[t.id] ?? { players: 0, coaches: 0 };
              return (
                <tr
                  key={t.id}
                  onClick={() => router.push(`/admin/teams/${t.id}`)}
                  style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--gray-light, rgba(0,0,0,0.03))')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <td style={{ padding: '6px 8px' }}>
                    <Link
                      href={`/admin/teams/${t.id}`}
                      style={{ color: 'var(--green-dark)', fontWeight: 500 }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {t.name}
                    </Link>
                  </td>
                  <td style={{ padding: '6px 8px' }}>{stats.players}</td>
                  <td style={{ padding: '6px 8px' }}>{stats.coaches}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveTeam(t);
                      }}
                      disabled={removingId === t.id}
                      className="btn-small"
                    >
                      {removingId === t.id ? 'Removing…' : 'Remove'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
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
