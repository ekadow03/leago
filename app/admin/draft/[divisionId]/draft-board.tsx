// app/admin/draft/[divisionId]/draft-board.tsx
'use client';

import { useEffect, useState, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { startDraftSession, makeDraftPick, undoLastPick } from '@/lib/actions/draft';
import { getCurrentPick } from '@/lib/draft-logic';

interface Team {
  id: string;
  name: string;
  coach_person_id: string | null;
}

interface Registration {
  id: string;
  person_id: string;
  team_id: string | null;
  people: { id: string; first_name: string; last_name: string };
}

interface Evaluation {
  person_id: string;
  overall_rating: number | null;
  scores: Record<string, number>;
  notes: string | null;
}

interface DraftSession {
  id: string;
  status: string;
  team_order: string[];
  current_pick_index: number;
  total_rounds: number | null;
}

interface Pick {
  id: string;
  pick_number: number;
  team_id: string;
  person_id: string;
  picked_at: string;
}

export default function DraftBoard({
  organizationId,
  seasonId,
  divisionId,
  divisionName,
  teams,
  registrations,
  evaluations,
  existingSession,
  initialPicks,
}: {
  organizationId: string;
  seasonId: string;
  divisionId: string;
  divisionName: string;
  teams: Team[];
  registrations: Registration[];
  evaluations: Evaluation[];
  existingSession: DraftSession | null;
  initialPicks: Pick[];
}) {
  const [session, setSession] = useState(existingSession);
  const [picks, setPicks] = useState(initialPicks);
  const [error, setError] = useState<string | null>(null);
  const [pickingId, setPickingId] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;

    let isCancelled = false;
    const supabase = createClient();

    async function setupChannel() {
      const {
        data: { session: authSession },
      } = await supabase.auth.getSession();

      if (authSession?.access_token) {
        supabase.realtime.setAuth(authSession.access_token);
      }

      if (isCancelled || !session) return;

      const channel = supabase
        .channel(`draft-${session.id}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'draft_picks', filter: `draft_session_id=eq.${session.id}` },
          (payload) => {
            setPicks((prev) => {
              if (prev.some((p) => p.id === payload.new.id)) return prev;
              return [...prev, payload.new as Pick].sort((a, b) => a.pick_number - b.pick_number);
            });
          }
        )
        .on(
          'postgres_changes',
          { event: 'DELETE', schema: 'public', table: 'draft_picks', filter: `draft_session_id=eq.${session.id}` },
          (payload) => {
            setPicks((prev) => prev.filter((p) => p.id !== payload.old.id));
          }
        )
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'draft_sessions', filter: `id=eq.${session.id}` },
          (payload) => {
            setSession(payload.new as DraftSession);
          }
        )
        .subscribe();

      channelRef.current = channel;
    }

    const channelRef = { current: null as ReturnType<typeof supabase.channel> | null };
    setupChannel();

    return () => {
      isCancelled = true;
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
    };
  }, [session?.id]);

  const draftedPersonIds = useMemo(() => new Set(picks.map((p) => p.person_id)), [picks]);
  const evalByPerson = useMemo(() => {
    const map = new Map<string, Evaluation>();
    evaluations.forEach((e) => map.set(e.person_id, e));
    return map;
  }, [evaluations]);

  const availablePlayers = registrations
    .filter((r) => !draftedPersonIds.has(r.person_id))
    .sort((a, b) => {
      const ratingA = evalByPerson.get(a.person_id)?.overall_rating ?? -1;
      const ratingB = evalByPerson.get(b.person_id)?.overall_rating ?? -1;
      return ratingB - ratingA;
    });

  const currentPick = session
    ? getCurrentPick(session.team_order, session.current_pick_index, session.total_rounds)
    : null;
  const currentTeam = teams.find((t) => t.id === currentPick?.teamId);

  async function handleDraft(personId: string) {
    if (!session) return;
    setPickingId(personId);
    setError(null);
    try {
      await makeDraftPick({ draftSessionId: session.id, personId });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setPickingId(null);
    }
  }

  async function handleUndo() {
    if (!session) return;
    setError(null);
    try {
      await undoLastPick(session.id);
    } catch (err: any) {
      setError(err.message);
    }
  }

  if (!session) {
    return (
      <DraftSetup
        organizationId={organizationId}
        seasonId={seasonId}
        divisionId={divisionId}
        divisionName={divisionName}
        teams={teams}
        onStarted={setSession}
      />
    );
  }

  return (
    <div>
      {error && <p style={{ color: '#B23A2E', marginBottom: 12 }}>{error}</p>}

      {session.status === 'complete' ? (
        <div className="on-clock-banner" style={{ background: 'var(--green-dark)' }}>
          <div className="pick-team">✅ Draft complete!</div>
        </div>
      ) : (
        <div className="on-clock-banner">
          <div className="pick-meta">
            Pick #{session.current_pick_index + 1} · Round {(currentPick?.round ?? 0) + 1}
          </div>
          <div className="pick-team">{currentTeam?.name ?? '—'}</div>
        </div>
      )}

      <div className="draft-columns">
        <div>
          <h3 style={{ fontWeight: 800 }}>Available Players ({availablePlayers.length})</h3>
          <div className="data-table-card">
            {availablePlayers.map((r) => {
              const evaluation = evalByPerson.get(r.person_id);
              return (
                <div key={r.id} className="player-row">
                  <div>
                    {r.people.first_name} {r.people.last_name}
                    {evaluation?.overall_rating != null && (
                      <span style={{ color: 'var(--gray)', fontSize: 13 }}> · rating {evaluation.overall_rating}</span>
                    )}
                  </div>
                  {session.status === 'live' && (
                    <button onClick={() => handleDraft(r.person_id)} disabled={pickingId !== null} className="btn-small">
                      {pickingId === r.person_id ? 'Drafting…' : 'Draft'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <h3 style={{ fontWeight: 800 }}>Rosters</h3>
          {teams.map((team) => {
            const teamPicks = picks.filter((p) => p.team_id === team.id).sort((a, b) => a.pick_number - b.pick_number);
            return (
              <div key={team.id} className="roster-group">
                <h4>{team.name}</h4>
                {teamPicks.length === 0 && <div style={{ color: 'var(--gray)', fontSize: 13 }}>No picks yet</div>}
                {teamPicks.map((p) => {
                  const reg = registrations.find((r) => r.person_id === p.person_id);
                  return (
                    <div key={p.id} className="roster-pick">
                      #{p.pick_number} — {reg?.people.first_name} {reg?.people.last_name}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {picks.length > 0 && (
        <button onClick={handleUndo} className="btn-small" style={{ marginTop: 20 }}>
          Undo last pick
        </button>
      )}
    </div>
  );
}

function DraftSetup({
  organizationId,
  seasonId,
  divisionId,
  divisionName,
  teams,
  onStarted,
}: {
  organizationId: string;
  seasonId: string;
  divisionId: string;
  divisionName: string;
  teams: Team[];
  onStarted: (session: DraftSession) => void;
}) {
  const [order, setOrder] = useState<string[]>(teams.map((t) => t.id));
  const [totalRounds, setTotalRounds] = useState<string>('');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function moveTeam(index: number, direction: -1 | 1) {
    setOrder((prev) => {
      const next = [...prev];
      const target = index + direction;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function handleStart() {
    setStarting(true);
    setError(null);
    try {
      const result = await startDraftSession({
        organizationId,
        seasonId,
        divisionId,
        teamOrder: order,
        totalRounds: totalRounds ? parseInt(totalRounds, 10) : undefined,
      });
      onStarted({
        id: result.id,
        status: 'live',
        team_order: order,
        current_pick_index: 0,
        total_rounds: totalRounds ? parseInt(totalRounds, 10) : null,
      });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setStarting(false);
    }
  }

  if (teams.length === 0) {
    return <p style={{ color: 'var(--gray)' }}>No teams exist in {divisionName} yet.</p>;
  }

  return (
    <div className="form-card" style={{ maxWidth: 420 }}>
      <h2>Round 1 pick order</h2>
      <p style={{ fontSize: 13, color: 'var(--gray)', marginTop: -12 }}>Snake draft — reverses each round.</p>

      {order.map((teamId, i) => {
        const team = teams.find((t) => t.id === teamId);
        return (
          <div key={teamId} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
            <span style={{ width: 24, color: 'var(--gray)' }}>{i + 1}.</span>
            <span style={{ flex: 1, fontWeight: 600 }}>{team?.name}</span>
            <button onClick={() => moveTeam(i, -1)} disabled={i === 0} className="btn-small">↑</button>
            <button onClick={() => moveTeam(i, 1)} disabled={i === order.length - 1} className="btn-small">↓</button>
          </div>
        );
      })}

      <label className="form-label" style={{ marginTop: 16 }}>Total rounds (optional)</label>
      <input
        type="number"
        value={totalRounds}
        onChange={(e) => setTotalRounds(e.target.value)}
        className="form-input"
        placeholder="Draft until pool is empty"
      />

      {error && <p style={{ color: '#B23A2E' }}>{error}</p>}

      <button onClick={handleStart} disabled={starting} className="btn-primary" style={{ width: '100%' }}>
        {starting ? 'Starting…' : 'Start draft'}
      </button>
    </div>
  );
}
