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
  location: string | null;
  start_date: string | null;
  end_date: string | null;
  entry_fee_cents: number;
  status: string;
  organizations: { name: string };
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
    <div style={{ maxWidth: 700, margin: '40px auto', fontFamily: 'system-ui', padding: '0 20px' }}>
      <h1>{tournament.name}</h1>
      <p style={{ color: '#666' }}>
        Hosted by {tournament.organizations.name}
        {tournament.location && ` · ${tournament.location}`}
        {tournament.start_date && ` · ${tournament.start_date}`}
      </p>
      {tournament.description && <p>{tournament.description}</p>}

      {tournament.status === 'registration_open' && (
        <RegistrationForm tournamentId={tournament.id} entryFeeCents={tournament.entry_fee_cents} />
      )}

      {tournament.status === 'registration_closed' && matches.length === 0 && (
        <p style={{ color: '#666' }}>Registration is closed. The bracket hasn't been generated yet.</p>
      )}

      {matches.length > 0 && (
        <>
          <h2 style={{ marginTop: 32 }}>Bracket</h2>
          <div style={{ display: 'flex', gap: 32, overflowX: 'auto' }}>
            {Array.from(new Set(matches.map((m) => m.round)))
              .sort((a, b) => a - b)
              .map((round) => (
                <div key={round}>
                  <h4>Round {round}</h4>
                  {matches
                    .filter((m) => m.round === round)
                    .map((m) => (
                      <div key={m.id} style={{ border: '1px solid #ddd', borderRadius: 6, padding: 8, marginBottom: 12, width: 180 }}>
                        <div style={{ fontSize: 13 }}>{teamName(m.team1_id)}</div>
                        <div style={{ fontSize: 13 }}>{teamName(m.team2_id)}</div>
                        {m.status === 'complete' && (
                          <div style={{ fontSize: 12, color: 'green', marginTop: 4 }}>
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
    return <p style={{ color: 'green', fontWeight: 600 }}>✅ {teamName} is registered!</p>;
  }

  if (clientSecret) {
    return (
      <div style={{ marginTop: 24 }}>
        <p>${(entryFeeCents / 100).toFixed(2)} entry fee for {teamName}</p>
        <Elements stripe={stripePromise} options={{ clientSecret }}>
          <PaymentForm />
        </Elements>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} style={{ marginTop: 24, border: '1px solid #ddd', borderRadius: 8, padding: 16 }}>
      <h3 style={{ marginTop: 0 }}>Register your team</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <input placeholder="Team name" value={teamName} onChange={(e) => setTeamName(e.target.value)} required />
        <input placeholder="Contact name" value={contactName} onChange={(e) => setContactName(e.target.value)} required />
        <input
          type="email"
          placeholder="Contact email"
          value={contactEmail}
          onChange={(e) => setContactEmail(e.target.value)}
          required
        />
        <input placeholder="Contact phone (optional)" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
        {error && <p style={{ color: 'red' }}>{error}</p>}
        <button type="submit" disabled={submitting}>
          {submitting ? 'Registering…' : entryFeeCents > 0 ? `Continue to payment ($${(entryFeeCents / 100).toFixed(2)})` : 'Register'}
        </button>
      </div>
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
    return <p style={{ color: 'green', marginTop: 16 }}>✅ Payment received — your team is registered!</p>;
  }

  return (
    <form onSubmit={handleSubmit} style={{ marginTop: 16 }}>
      <PaymentElement />
      <button type="submit" disabled={!stripe || status === 'processing'} style={{ marginTop: 16 }}>
        {status === 'processing' ? 'Processing…' : 'Pay now'}
      </button>
      {status === 'error' && <p style={{ color: 'red', marginTop: 12 }}>{errorMessage}</p>}
    </form>
  );
}