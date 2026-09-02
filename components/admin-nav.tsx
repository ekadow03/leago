// components/admin-nav.tsx
//
// Shared tab row across every /admin/* page so an org admin can actually
// navigate between admin sections instead of needing to know each URL.

import Link from 'next/link';

const ADMIN_LINKS = [
  { href: '/admin', label: 'Dashboard' },
  { href: '/admin/members', label: 'Members' },
  { href: '/admin/teams', label: 'Teams' },
  { href: '/admin/schedule', label: 'Schedule' },
  { href: '/admin/registrations', label: 'Registrations' },
  { href: '/admin/compliance', label: 'Compliance' },
  { href: '/admin/tournaments', label: 'Tournaments' },
  { href: '/admin/league-hub', label: 'League Hub' },
  { href: '/admin/branding', label: 'Branding' },
  { href: '/admin/billing', label: 'Billing' },
];

export default function AdminNav({ active }: { active: string }) {
  return (
    <div className="admin-subnav">
      {ADMIN_LINKS.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className={`admin-subnav-link ${active === link.href ? 'active' : ''}`}
        >
          {link.label}
        </Link>
      ))}
    </div>
  );
}
