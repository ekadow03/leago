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
import { uploadRegistrationBirthCertificate } from '@/lib/actions/registration-documents';
import { isEligibleForDivision } from '@/lib/age-eligibility';

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);

type RegistrationType = 'player' | 'coach' | 'volunteer';

interface HouseholdMember {
  id: string;
  first_name: string;
  last_name: string;
  dob: string | null;
  isSelf: boolean;
}

interface RegistrationSettings {
  require_waiver: boolean;
  waiver_text: string | null;
  require_birth_certificate: boolean;
  offer_jersey_size: boolean;
  jersey_sizes: string[];
  offer_hat_size: boolean;
  hat_sizes: string[];
  offer_jersey_number: boolean;
  offer_years_experience: boolean;
}

interface Props {
  divisionId: string;
  divisionName: string;
  ageMin: number | null;
  ageMax: number | null;
  ageCutoffDate: string | null;
  seasonId: string;
  seasonName: string;
  organizationId: string;
  organizationName: string;
  priceCents: number;
  household: HouseholdMember[];
  initialPersonId: string;
  registrationSettings: RegistrationSettings | null;
}

export default function RegistrationForm(props: Props) {
  const selfPersonId = props.household.find((m) => m.isSelf)?.id ?? props.initialPersonId;
  const [personId, setPersonId] = useState(props.initialPersonId);
  const [registrationType, setRegistrationType] = useState<RegistrationType>('player');
  const [waiverAgreed, setWaiverAgreed] = useState(false);
  const [waiverSignedName, setWaiverSignedName] = useState('');
  const [birthCertificatePath, setBirthCertificatePath] = useState<string | null>(null);
  const [uploadingCert, setUploadingCert] = useState(false);
  const [jerseySize, setJerseySize] = useState('');
  const [hatSize, setHatSize] = useState('');
  const [jerseyNumber, setJerseyNumber] = useState('');
  const [yearsExperience, setYearsExperience] = useState('');
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [confirmedFree, setConfirmedFree] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const amountCents = registrationType === 'player' ? props.priceCents : 0;
  const selectedMember = props.household.find((m) => m.id === personId);
  const settings = props.registrationSettings;

  const eligible =
    registrationType !== 'player' ||
    isEligibleForDivision(selectedMember?.dob ?? null, props.ageCutoffDate, props.ageMin, props.ageMax);

  async function handleCertChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingCert(true);
    setError(null);
    try {
      const result = await uploadRegistrationBirthCertificate({ personId, file });
      if ('error' in result) {
        setError(result.error);
        return;
      }
      setBirthCertificatePath(result.storagePath);
    } catch (err: any) {
      setError(err.message ?? 'Upload failed.');
    } finally {
      setUploadingCert(false);
    }
  }

  async function handleStart(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (settings?.require_waiver && (!waiverAgreed || !waiverSignedName.trim())) {
      setError('Please read and sign the waiver to continue.');
      return;
    }
    if (settings?.require_birth_certificate && !birthCertificatePath) {
      setError('Please upload a birth certificate to continue.');
      return;
    }

    setSubmitting(true);

    try {
      const result = await createRegistration({
        organizationId: props.organizationId,
        seasonId: props.seasonId,
        divisionId: props.divisionId,
        personId,
        submittedByPersonId: selfPersonId,
        registrationType,
        waiverSignedName: settings?.require_waiver ? waiverSignedName.trim() : undefined,
        birthCertificatePath: birthCertificatePath ?? undefined,
        jerseySize: jerseySize || undefined,
        hatSize: hatSize || undefined,
        jerseyNumber: jerseyNumber.trim() || undefined,
        yearsExperience: yearsExperience ? Number(yearsExperience) : undefined,
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
          {selectedMember?.first_name} is registered as a {registrationType} for {props.divisionName} —{' '}
          {props.seasonName}. No payment was required for this role.
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
      {props.household.length > 1 && (
        <>
          <h2>Who&apos;s registering?</h2>
          {props.household.map((m) => (
            <label key={m.id} className="radio-option">
              <input
                type="radio"
                name="householdMember"
                value={m.id}
                checked={personId === m.id}
                onChange={() => setPersonId(m.id)}
              />
              <span className="radio-option-label">
                {m.first_name} {m.last_name} {m.isSelf && '(you)'}
              </span>
            </label>
          ))}
        </>
      )}

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

      {registrationType === 'player' && !eligible && (
        <p style={{ color: '#B23A2E', fontSize: 13, marginTop: 8 }}>
          {selectedMember?.first_name ?? 'This player'} may be outside the age range for {props.divisionName}
          {props.ageMin && props.ageMax ? ` (ages ${props.ageMin}–${props.ageMax})` : ''}. You can still submit, but
          the league will need to confirm eligibility.
        </p>
      )}

      {settings?.offer_jersey_size && settings.jersey_sizes.length > 0 && (
        <>
          <label className="form-label">Jersey size</label>
          <select value={jerseySize} onChange={(e) => setJerseySize(e.target.value)} className="form-input">
            <option value="">Select a size…</option>
            {settings.jersey_sizes.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </>
      )}

      {settings?.offer_hat_size && settings.hat_sizes.length > 0 && (
        <>
          <label className="form-label">Hat size</label>
          <select value={hatSize} onChange={(e) => setHatSize(e.target.value)} className="form-input">
            <option value="">Select a size…</option>
            {settings.hat_sizes.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </>
      )}

      {settings?.offer_jersey_number && (
        <>
          <label className="form-label">Requested jersey number</label>
          <input value={jerseyNumber} onChange={(e) => setJerseyNumber(e.target.value)} className="form-input" placeholder="e.g. 23" />
        </>
      )}

      {settings?.offer_years_experience && (
        <>
          <label className="form-label">Years of experience</label>
          <input
            type="number"
            min="0"
            value={yearsExperience}
            onChange={(e) => setYearsExperience(e.target.value)}
            className="form-input"
          />
        </>
      )}

      {settings?.require_birth_certificate && (
        <>
          <label className="form-label">Birth certificate</label>
          <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={handleCertChange} disabled={uploadingCert} className="form-input" />
          {uploadingCert && <p style={{ fontSize: 13, color: 'var(--gray)' }}>Uploading…</p>}
          {birthCertificatePath && !uploadingCert && <p style={{ fontSize: 13, color: 'var(--green-dark)' }}>Uploaded</p>}
        </>
      )}

      {settings?.require_waiver && (
        <div style={{ marginTop: 16, padding: 12, background: 'var(--cream)', borderRadius: 8 }}>
          <p style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{settings.waiver_text || 'By signing below, you agree to the terms of participation.'}</p>
          <label className="radio-option">
            <input type="checkbox" checked={waiverAgreed} onChange={(e) => setWaiverAgreed(e.target.checked)} />
            <span className="radio-option-label">I have read and agree to the waiver</span>
          </label>
          <label className="form-label">Signed name</label>
          <input
            value={waiverSignedName}
            onChange={(e) => setWaiverSignedName(e.target.value)}
            className="form-input"
            placeholder="Type your full legal name"
          />
        </div>
      )}

      {error && <p style={{ color: '#B23A2E', fontSize: 14, marginTop: 12 }}>{error}</p>}

      <button type="submit" disabled={submitting || uploadingCert} className="btn-primary" style={{ width: '100%', marginTop: 16 }}>
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
