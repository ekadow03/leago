// app/admin/branding/branding-form.tsx
'use client';

import { useState } from 'react';
import { updateBranding } from '@/lib/actions/branding';

export default function BrandingForm({
  organizationId,
  currentSubdomain,
  currentLogoUrl,
  currentPrimaryColor,
}: {
  organizationId: string;
  currentSubdomain: string;
  currentLogoUrl: string;
  currentPrimaryColor: string;
}) {
  const [subdomain, setSubdomain] = useState(currentSubdomain);
  const [logoUrl, setLogoUrl] = useState(currentLogoUrl);
  const [primaryColor, setPrimaryColor] = useState(currentPrimaryColor || '#0B132B');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN || 'leago.com';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setSaved(false);
    try {
      await updateBranding({ organizationId, subdomain, logoUrl, primaryColor });
      setSaved(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="form-card" style={{ maxWidth: 480 }}>
      <label className="form-label">Subdomain</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <input
          value={subdomain}
          onChange={(e) => setSubdomain(e.target.value)}
          className="form-input"
          style={{ marginBottom: 0 }}
          placeholder="yourleague"
        />
        <span style={{ color: 'var(--gray)', fontSize: 14, whiteSpace: 'nowrap' }}>.{rootDomain}</span>
      </div>
      <p style={{ fontSize: 12, color: 'var(--gray)', marginTop: 0, marginBottom: 16 }}>
        Visitors to this subdomain will see your tournaments with your own branding. Only works once this app is
        deployed to a real domain with wildcard DNS — not testable on localhost.
      </p>

      <label className="form-label">Logo URL</label>
      <input
        value={logoUrl}
        onChange={(e) => setLogoUrl(e.target.value)}
        className="form-input"
        placeholder="https://yoursite.com/logo.png"
      />

      <label className="form-label">Primary color</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <input
          type="color"
          value={primaryColor}
          onChange={(e) => setPrimaryColor(e.target.value)}
          style={{ width: 44, height: 36, padding: 2, border: '1.5px solid var(--gray-light)', borderRadius: 8 }}
        />
        <input
          value={primaryColor}
          onChange={(e) => setPrimaryColor(e.target.value)}
          className="form-input"
          style={{ marginBottom: 0 }}
        />
      </div>

      {error && <p style={{ color: '#B23A2E', fontSize: 14 }}>{error}</p>}
      {saved && <p style={{ color: 'var(--green-dark)', fontSize: 14, fontWeight: 600 }}>Saved.</p>}

      <button type="submit" disabled={submitting} className="btn-primary" style={{ width: '100%' }}>
        {submitting ? 'Saving…' : 'Save branding'}
      </button>
    </form>
  );
}