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
    <div>
      {error && <p style={{ color: '#B23A2E', marginBottom: 12 }}>{error}</p>}

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 24, flexWrap: 'wrap' }}>
        <span className={`status-badge ${status === 'complete' ? 'confirmed' : 'pending'}`}>{status}</span>
        {status === 'draft' && (
          <button onClick={() => handleStatusChange('registration_open')} disabled={busy} className="btn-small">
            Open registration
          </button>
        )}
        {status === 'registration_open' && (
          <>
            <button onClick={() => handleStatusChange('registration_closed')} disabled={busy} className="btn-small">
              Close registration
            </button>
            <span style={{ fontSize: 13, color: 'var(--gray)' }}>
              Public link: <code>{registrationUrl}</code>
            </span>
          </>
        )}
        {status === 'registration_closed' && matches.length === 0 && (
          <button onClick={handleGenerateBracket} disabled={busy || confirmedTeams.length < 2} className="btn-primary">
            {busy ? 'Generating…' : `Generate bracket (${confirmedTeams.length} teams)`}
          </button>
        )}
      </div>

      <h3 style={{ fontWeight: 800 }}>Teams ({teams.length})</h3>
      {teams.length === 0 && <p style={{ color: 'var(--gray)' }}>No teams registered yet.</p>}
      {teams.length > 0 && (
        <div className="data-table-card" style={{ marginBottom: 32 }}>
          {teams.map((t) => (
            <div key={t.id} className="data-row">
              <div>
                <div className="data-row-name">{t.team_name}</div>
                <div className="data-row-meta">
                  {t.contact_name} · {t.contact_email}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <span className={`status-badge ${t.status}`}>{t.status}</span>
                <span className={`status-badge ${t.payment_status}`}>{t.payment_status}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {matches.length > 0 && (
        <>
          <h3 style={{ fontWeight: 800 }}>Bracket</h3>
          <div className="bracket-columns">
            {Array.from(new Set(matches.map((m) => m.round)))
              .sort((a, b) => a - b)
              .map((round) => (
                <div key={round}>
                  <h4 style={{ fontWeight: 700, fontSize: 14 }}>Round {round}</h4>
                  {matches
                    .filter((m) => m.round === round)
                    .map((m) => (
                      <MatchRow key={m.id} organizationId={organizationId} match={m} teamName={teamName} />
                    ))}
                </div>
              ))}
          </div>
        </>
      )}
    </div>
  );
}

function MatchRow({
  organizationId,
  match,
  teamName,
}: {
  organizationId: string;
  match: Match;
  teamName: (id: string | null) => string;
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
    <div className="bracket-match">
      <div className="team-line">{teamName(match.team1_id)}</div>
      <div className="team-line">{teamName(match.team2_id)}</div>

      {match.status === 'complete' ? (
        <div className="bracket-score">
          {match.score_team1}–{match.score_team2} · {teamName(match.winner_team_id)}
        </div>
      ) : canEnterScore ? (
        <div style={{ marginTop: 8, display: 'flex', gap: 4, alignItems: 'center' }}>
          <input type="number" value={score1} onChange={(e) => setScore1(e.target.value)} className="form-input" style={{ width: 44, padding: 6, marginBottom: 0, fontSize: 12 }} />
          <input type="number" value={score2} onChange={(e) => setScore2(e.target.value)} className="form-input" style={{ width: 44, padding: 6, marginBottom: 0, fontSize: 12 }} />
          <button onClick={handleSubmit} disabled={submitting || !score1 || !score2} className="btn-small">
            Save
          </button>
        </div>
      ) : (
        <div style={{ fontSize: 12, color: 'var(--gray)', marginTop: 6 }}>Waiting for teams</div>
      )}
      {error && <div style={{ fontSize: 11, color: '#B23A2E' }}>{error}</div>}
    </div>
  );
}
