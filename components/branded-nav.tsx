// components/branded-nav.tsx
//
// Used on public tournament pages instead of the shared Leago <Nav /> —
// renders the HOSTING organization's own name/logo/color so their
// tournament page looks like their own platform, not "leago's."

interface BrandingTheme {
  logoUrl?: string | null;
  primaryColor?: string | null;
}

export default function BrandedNav({
  organizationName,
  branding,
}: {
  organizationName: string;
  branding?: BrandingTheme | null;
}) {
  const bg = branding?.primaryColor || 'var(--navy)';

  return (
    <nav className="nav" style={{ background: bg }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {branding?.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={branding.logoUrl} alt={organizationName} style={{ height: 28, width: 'auto' }} />
        ) : null}
        <span style={{ fontWeight: 800, fontSize: 20, color: 'white' }}>{organizationName}</span>
      </div>
      <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>Powered by leago</span>
    </nav>
  );
}