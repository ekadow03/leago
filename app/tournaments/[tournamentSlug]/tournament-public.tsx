// app/tournaments/[tournamentSlug]/tournament-public.tsx
'use client';

import { useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { registerTournamentTeam } from '@/lib/actions/tournaments';

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);

interface Tournament {
  id: string;
  name: string;
  description: string | null;
  entry_fee_cents: number;
  status: string;
}

interface Team {
  id: string;
  team_name: string;
  status: string;
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

export default function TournamentPublic({
  tournament,
  teams,
  matches,
}: {
  tournament: Tournament;
  teams: Team[];
  matches: Match[];
}) {
  function teamName(teamId: string | null) {
    return teams.find((t) => t.id === teamId)?.team_name ?? (teamId ? '—' : 'BYE');
  }

  return (
    <div>
      {tournament.description && <p style={{ color: 'var(--gray)', marginBottom: 20 }}>{tournament.description}</p>}

      {tournament.status === 'registration_open' && (
        <RegistrationForm tournamentId={tournament.id} entryFeeCents={tournament.entry_fee_cents} />
      )}

      {tournament.status === 'registration_closed' && matches.length === 0 && (
        <p style={{ color: 'var(--gray)' }}>Registration is closed. The bracket hasn't been generated yet.</p>
      )}

      {matches.length > 0 && (
        <>
          <h2 style={{ fontWeight: 800, marginTop: 32 }}>Bracket</h2>
          <div className="bracket-columns">
            {Array.from(new Set(matches.map((m) => m.round)))
              .sort((a, b) => a - b)
              .map((round) => (
                <div key={round}>
                  <h4 style={{ fontWeight: 700, fontSize: 14 }}>Round {round}</h4>
                  {matches
                    .filter((m) => m.round === round)
                    .map((m) => (
                      <div key={m.id} className="bracket-match">
                        <div className="team-line">{teamName(m.team1_id)}</div>
                        <div className="team-line">{teamName(m.team2_id)}</div>
                        {m.status === 'complete' && (
                          <div className="bracket-score">
                            {m.score_team1}–{m.score_team2}
                          </div>
                        )}
                      </div>
                    ))}
                </div>
              ))}
          </div>
        </>
      )}
    </div>
  );
}

function RegistrationForm({ tournamentId, entryFeeCents }: { tournamentId: string; entryFeeCents: number }) {
  const [teamName, setTeamName] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [confirmedFree, setConfirmedFree] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const result = await registerTournamentTeam({
        tournamentId,
        teamName,
        contactName,
        contactEmail,
        contactPhone: contactPhone || undefined,
      });
      if (entryFeeCents === 0) {
        setConfirmedFree(true);
      } else {
        setClientSecret(result.clientSecret);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (confirmedFree) {
    return (
      <div className="form-card" style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
        <p style={{ fontWeight: 700, color: 'var(--green-dark)' }}>{teamName} is registered!</p>
      </div>
    );
  }

  if (clientSecret) {
    return (
      <div className="form-card">
        <h2>${(entryFeeCents / 100).toFixed(2)} entry — {teamName}</h2>
        <Elements stripe={stripePromise} options={{ clientSecret }}>
          <PaymentForm />
        </Elements>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="form-card">
      <h2>Register your team</h2>
      <label className="form-label">Team name</label>
      <input value={teamName} onChange={(e) => setTeamName(e.target.value)} className="form-input" required />
      <label className="form-label">Contact name</label>
      <input value={contactName} onChange={(e) => setContactName(e.target.value)} className="form-input" required />
      <label className="form-label">Contact email</label>
      <input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} className="form-input" required />
      <label className="form-label">Contact phone (optional)</label>
      <input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} className="form-input" />
      {error && <p style={{ color: '#B23A2E', fontSize: 14 }}>{error}</p>}
      <button type="submit" disabled={submitting} className="btn-primary" style={{ width: '100%' }}>
        {submitting ? 'Registering…' : entryFeeCents > 0 ? `Continue to payment ($${(entryFeeCents / 100).toFixed(2)})` : 'Register'}
      </button>
    </form>
  );
}

function PaymentForm() {
  const stripe = useStripe();
  const elements = useElements();
  const [status, setStatus] = useState<'idle' | 'processing' | 'succeeded' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setStatus('processing');
    setErrorMessage(null);

    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: window.location.href },
      redirect: 'if_required',
    });

    if (error) {
      setStatus('error');
      setErrorMessage(error.message ?? 'Payment failed.');
      return;
    }
    if (paymentIntent?.status === 'succeeded') {
      setStatus('succeeded');
    }
  }

  if (status === 'succeeded') {
    return <p style={{ color: 'var(--green-dark)', fontWeight: 700, marginTop: 16 }}>✅ Payment received — your team is registered!</p>;
  }

  return (
    <form onSubmit={handleSubmit} style={{ marginTop: 16 }}>
      <PaymentElement />
      <button type="submit" disabled={!stripe || status === 'processing'} className="btn-primary" style={{ width: '100%', marginTop: 20 }}>
        {status === 'processing' ? 'Processing…' : 'Pay now'}
      </button>
      {status === 'error' && <p style={{ color: '#B23A2E', marginTop: 12, fontSize: 14 }}>{errorMessage}</p>}
    </form>
  );
}
