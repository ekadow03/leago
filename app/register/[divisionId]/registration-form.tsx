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

  // Only "player" registrations are priced in this simple version — coach
  // and volunteer sign-ups are free. Adjust here once real per-role pricing
  // rules exist.
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
      <div style={{ maxWidth: 480, margin: '80px auto', fontFamily: 'system-ui' }}>
        <h1>✅ Registration confirmed</h1>
        <p>
          You're registered as a {registrationType} for {props.divisionName} —{' '}
          {props.seasonName}. No payment was required for this role.
        </p>
      </div>
    );
  }

  if (clientSecret) {
    return (
      <div style={{ maxWidth: 480, margin: '80px auto', fontFamily: 'system-ui' }}>
        <h1>Payment</h1>
        <p style={{ color: '#666' }}>
          {props.divisionName} — {props.seasonName} · $
          {(amountCents / 100).toFixed(2)}
        </p>
        <Elements stripe={stripePromise} options={{ clientSecret }}>
          <PaymentForm />
        </Elements>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 480, margin: '80px auto', fontFamily: 'system-ui' }}>
      <h1>{props.organizationName}</h1>
      <p style={{ color: '#666' }}>
        {props.seasonName} — {props.divisionName}
      </p>

      <form onSubmit={handleStart} style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 24 }}>
        <fieldset style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12 }}>
          <legend>Registering as</legend>
          {(['player', 'coach', 'volunteer'] as const).map((type) => (
            <label key={type} style={{ display: 'block', padding: '4px 0' }}>
              <input
                type="radio"
                name="registrationType"
                value={type}
                checked={registrationType === type}
                onChange={() => setRegistrationType(type)}
              />{' '}
              {type.charAt(0).toUpperCase() + type.slice(1)}
              {type === 'player' && ` — $${(props.priceCents / 100).toFixed(2)}`}
              {type !== 'player' && ' — free'}
            </label>
          ))}
        </fieldset>

        {error && <p style={{ color: 'red' }}>{error}</p>}

        <button type="submit" disabled={submitting}>
          {submitting
            ? 'Please wait…'
            : amountCents > 0
              ? `Continue to payment ($${(amountCents / 100).toFixed(2)})`
              : 'Complete registration'}
        </button>
      </form>
    </div>
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
      <p style={{ color: 'green', marginTop: 16 }}>
        ✅ Payment received — your registration is confirmed!
      </p>
    );
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
