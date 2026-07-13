// app/admin/tournaments/[tournamentId]/tournament-admin.tsx
'use client';

import { useState } from 'react';
import { setTournamentStatus, generateBracket, recordMatchResult } from '@/lib/actions/tournaments';

interface Tournament {
  id: string;
  organization_id: string;
  name: string;
  slug: string;
  status: string;
  entry_fee_cents: number;
}

interface Team {
  id: string;
  team_name: string;
  contact_name: string;
  contact_email: string;
  status: string;
  payment_status: string;
}

interface Match {
  id: string;
  round: number;
  match_number: number;
  team1_id: string | null;
  team2_id: string | null;
  winner_team_id: string | null;
  score_team1: number | null;
  score_team2: number | null;
  status: string;
}

export default function TournamentAdmin({
  organizationId,
  tournament,
  initialTeams,
  initialMatches,
}: {
  organizationId: string;
  tournament: Tournament;
  initialTeams: Team[];
  initialMatches: Match[];
}) {
  const [status, setStatus] = useState(tournament.status);
  const [teams, setTeams] = useState(initialTeams);
  const [matches, setMatches] = useState(initialMatches);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const confirmedTeams = teams.filter((t) => t.status === 'confirmed');

  async function handleStatusChange(newStatus: Tournament['status']) {
    setBusy(true);
    setError(null);
    try {
      await setTournamentStatus(organizationId, tournament.id, newStatus as any);
      setStatus(newStatus);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleGenerateBracket() {
    setBusy(true);
    setError(null);
    try {
      await generateBracket(organizationId, tournament.id);
      window.location.reload();
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  }

  function teamName(teamId: string | null) {
    return teams.find((t) => t.id === teamId)?.team_name ?? (teamId ? '—' : 'BYE');
  }

  const registrationUrl =
    typeof window !== 'undefined' ? `${window.location.origin}/tournaments/${tournament.slug}` : '';

  return (
    <div style={{ maxWidth: 800, margin: '40px auto', fontFamily: 'system-ui', padding: '0 20px' }}>
      <h1>{tournament.name}</h1>
      <p style={{ color: '#666' }}>
        Status: <strong>{status}</strong> · Entry fee: ${(tournament.entry_fee_cents / 100).toFixed(2)}
      </p>

      {error && <p style={{ color: 'red' }}>{error}</p>}

      <div style={{ marginBottom: 24 }}>
        {status === 'draft' && (
          <button onClick={() => handleStatusChange('registration_open')} disabled={busy}>
            Open registration
          </button>
        )}
        {status === 'registration_open' && (
          <>
            <button onClick={() => handleStatusChange('registration_closed')} disabled={busy} style={{ marginRight: 8 }}>
              Close registration
            </button>
            <span style={{ fontSize: 13, color: '#666' }}>
              Public link: <code>{registrationUrl}</code>
            </span>
          </>
        )}
        {(status === 'registration_closed') && matches.length === 0 && (
          <button onClick={handleGenerateBracket} disabled={busy || confirmedTeams.length < 2}>
            {busy ? 'Generating…' : `Generate bracket (${confirmedTeams.length} confirmed teams)`}
          </button>
        )}
      </div>

      <h2>Teams ({teams.length})</h2>
      {teams.length === 0 && <p style={{ color: '#666' }}>No teams registered yet.</p>}
      {teams.map((t) => (
        <div key={t.id} style={{ padding: '6px 0', borderBottom: '1px solid #eee', fontSize: 14 }}>
          <strong>{t.team_name}</strong> — {t.contact_name} ({t.contact_email}){' '}
          <span style={{ color: '#999' }}>
            [{t.status} / {t.payment_status}]
          </span>
        </div>
      ))}

      {matches.length > 0 && (
        <>
          <h2 style={{ marginTop: 32 }}>Bracket</h2>
          <BracketView
            organizationId={organizationId}
            matches={matches}
            setMatches={setMatches}
            teamName={teamName}
          />
        </>
      )}
    </div>
  );
}

function BracketView({
  organizationId,
  matches,
  setMatches,
  teamName,
}: {
  organizationId: string;
  matches: Match[];
  setMatches: React.Dispatch<React.SetStateAction<Match[]>>;
  teamName: (id: string | null) => string;
}) {
  const rounds = Array.from(new Set(matches.map((m) => m.round))).sort((a, b) => a - b);

  return (
    <div style={{ display: 'flex', gap: 32, overflowX: 'auto' }}>
      {rounds.map((round) => (
        <div key={round}>
          <h4>Round {round}</h4>
          {matches
            .filter((m) => m.round === round)
            .map((m) => (
              <MatchRow key={m.id} organizationId={organizationId} match={m} teamName={teamName} setMatches={setMatches} />
            ))}
        </div>
      ))}
    </div>
  );
}

function MatchRow({
  organizationId,
  match,
  teamName,
  setMatches,
}: {
  organizationId: string;
  match: Match;
  teamName: (id: string | null) => string;
  setMatches: React.Dispatch<React.SetStateAction<Match[]>>;
}) {
  const [score1, setScore1] = useState(match.score_team1?.toString() ?? '');
  const [score2, setScore2] = useState(match.score_team2?.toString() ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canEnterScore = match.team1_id && match.team2_id && match.status !== 'complete';

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      await recordMatchResult(organizationId, match.id, parseInt(score1, 10), parseInt(score2, 10));
      window.location.reload();
    } catch (err: any) {
      setError(err.message);
      setSubmitting(false);
    }
  }

  return (
    <div style={{ border: '1px solid #ddd', borderRadius: 6, padding: 8, marginBottom: 12, width: 200 }}>
      <div style={{ fontSize: 13 }}>{teamName(match.team1_id)}</div>
      <div style={{ fontSize: 13 }}>{teamName(match.team2_id)}</div>

      {match.status === 'complete' ? (
        <div style={{ fontSize: 12, color: 'green', marginTop: 4 }}>
          {match.score_team1}–{match.score_team2} · Winner: {teamName(match.winner_team_id)}
        </div>
      ) : canEnterScore ? (
        <div style={{ marginTop: 4, display: 'flex', gap: 4, alignItems: 'center' }}>
          <input type="number" value={score1} onChange={(e) => setScore1(e.target.value)} style={{ width: 40, fontSize: 12 }} />
          <input type="number" value={score2} onChange={(e) => setScore2(e.target.value)} style={{ width: 40, fontSize: 12 }} />
          <button onClick={handleSubmit} disabled={submitting || !score1 || !score2} style={{ fontSize: 11 }}>
            Save
          </button>
        </div>
      ) : (
        <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>Waiting for teams</div>
      )}
      {error && <div style={{ fontSize: 11, color: 'red' }}>{error}</div>}
    </div>
  );
}