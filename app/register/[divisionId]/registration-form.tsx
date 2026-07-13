// app/register/[divisionId]/registration-form.tsx
'use client';

import { useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js';
import { createRegistration } from '@/lib/actions/registrations';

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);

type RegistrationType = 'player' | 'coach' | 'volunteer';

interface Props {
  divisionId: string;
  divisionName: string;
  seasonId: string;
  seasonName: string;
  organizationId: string;
  organizationName: string;
  priceCents: number;
  personId: string;
}

export default function RegistrationForm(props: Props) {
  const [registrationType, setRegistrationType] = useState<RegistrationType>('player');
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [confirmedFree, setConfirmedFree] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const amountCents = registrationType === 'player' ? props.priceCents : 0;

  async function handleStart(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const result = await createRegistration({
        organizationId: props.organizationId,
        seasonId: props.seasonId,
        personId: props.personId,
        registrationType,
        amountCents,
      });

      if (amountCents === 0) {
        setConfirmedFree(true);
      } else {
        setClientSecret(result.clientSecret);
      }
    } catch (err: any) {
      setError(err.message ?? 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  }

  if (confirmedFree) {
    return (
      <div className="form-card" style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
        <h2>Registration confirmed</h2>
        <p style={{ color: 'var(--gray)' }}>
          You're registered as a {registrationType} for {props.divisionName} — {props.seasonName}.
          No payment was required for this role.
        </p>
      </div>
    );
  }

  if (clientSecret) {
    return (
      <div className="form-card">
        <h2>Payment</h2>
        <p style={{ color: 'var(--gray)', marginTop: -12, marginBottom: 20 }}>
          {props.divisionName} — {props.seasonName} · ${(amountCents / 100).toFixed(2)}
        </p>
        <Elements stripe={stripePromise} options={{ clientSecret }}>
          <PaymentForm />
        </Elements>
      </div>
    );
  }

  return (
    <form onSubmit={handleStart} className="form-card">
      <h2>Registering as</h2>

      {(['player', 'coach', 'volunteer'] as const).map((type) => (
        <label key={type} className="radio-option">
          <input
            type="radio"
            name="registrationType"
            value={type}
            checked={registrationType === type}
            onChange={() => setRegistrationType(type)}
          />
          <span className="radio-option-label">
            {type.charAt(0).toUpperCase() + type.slice(1)}
          </span>
          <span className="radio-option-price">
            {type === 'player' ? `$${(props.priceCents / 100).toFixed(0)}` : 'Free'}
          </span>
        </label>
      ))}

      {error && <p style={{ color: '#B23A2E', fontSize: 14, marginTop: 12 }}>{error}</p>}

      <button type="submit" disabled={submitting} className="btn-primary" style={{ width: '100%', marginTop: 16 }}>
        {submitting
          ? 'Please wait…'
          : amountCents > 0
            ? `Continue to payment ($${(amountCents / 100).toFixed(2)})`
            : 'Complete registration'}
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
    return (
      <div style={{ textAlign: 'center', padding: '20px 0' }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
        <p style={{ color: 'var(--green-dark)', fontWeight: 700 }}>
          Payment received — your registration is confirmed!
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} style={{ marginTop: 8 }}>
      <PaymentElement />
      <button
        type="submit"
        disabled={!stripe || status === 'processing'}
        className="btn-primary"
        style={{ width: '100%', marginTop: 20 }}
      >
        {status === 'processing' ? 'Processing…' : 'Pay now'}
      </button>
      {status === 'error' && <p style={{ color: '#B23A2E', marginTop: 12, fontSize: 14 }}>{errorMessage}</p>}
    </form>
  );
}