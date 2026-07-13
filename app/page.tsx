// app/page.tsx
//
// The actual marketing homepage now — root used to redirect straight to
// /register (which is for parents/players), but that's the wrong front
// door for a league considering signing UP for the platform. This is
// that front door; /register remains reachable and linked from here.

import Link from 'next/link';
import Nav from '@/components/nav';

const FEATURES = [
  { title: 'Registration & Payments', body: 'Online sign-up with Stripe payments, refunds, and full historical records.' },
  { title: 'Live Draft Tool', body: 'Run evaluation day, then draft teams live with real-time sync across every screen.' },
  { title: 'Scheduling', body: 'Build your season schedule and publish it for players and families to see.' },
  { title: 'Compliance', body: 'Birth certificates, coach certifications, and background checks — tracked in one place.' },
  { title: 'Volunteer Management', body: 'Post shifts, let members sign up, track who\'s covered.' },
  { title: 'Tournament Hosting', body: 'Host tournaments for outside teams with your own branding, no account required for entrants.' },
];

export default function MarketingHomePage() {
  return (
    <div>
      <Nav />

      <div className="hero-band">
        <p className="hero-eyebrow">Everything your league needs</p>
        <h1 className="hero-title">
          Run your season. <span className="accent">Not your software.</span>
        </h1>
        <p className="hero-subtitle">
          Leago brings registration, scheduling, payments, drafts, and communication together in one platform built
          for sports organizations.
        </p>
        <div style={{ marginTop: 28 }}>
          <Link href="/get-started" className="btn-primary" style={{ textDecoration: 'none', display: 'inline-block' }}>
            Get started free
          </Link>
        </div>
      </div>

      <div className="card-grid" style={{ marginTop: -56 }}>
        {FEATURES.map((f) => (
          <div key={f.title} className="card">
            <h2 className="card-title" style={{ fontSize: 19 }}>{f.title}</h2>
            <p className="card-meta">{f.body}</p>
          </div>
        ))}
      </div>

      <div className="hero-band" style={{ paddingTop: 48, paddingBottom: 48 }}>
        <h2 className="hero-title" style={{ fontSize: 'clamp(24px, 3.5vw, 34px)' }}>
          Ready to run your season?
        </h2>
        <div style={{ marginTop: 20 }}>
          <Link href="/get-started" className="btn-primary" style={{ textDecoration: 'none', display: 'inline-block' }}>
            Create your league
          </Link>
        </div>
        <p style={{ marginTop: 16, fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>
          Registering as a player or volunteer instead?{' '}
          <Link href="/register" style={{ color: 'var(--green)' }}>
            Find your league here
          </Link>
        </p>
      </div>
    </div>
  );
}