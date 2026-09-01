'use client';

// app/dashboard/dashboard-client.tsx

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { addHouseholdMember } from '@/lib/actions/household';
import { isEligibleForDivision } from '@/lib/age-eligibility';

interface HouseholdMember {
  id: string;
  first_name: string;
  last_name: string;
  dob: string | null;
  isSelf: boolean;
}

interface Registration {
  id: string;
  person_id: string;
  registration_type: 'player' | 'coach' | 'volunteer';
  status: string;
  payment_status: string;
  amount_cents: number;
  division: { id: string; name: string } | null;
  season: { id: string; name: string; organization: { id: string; name: string } } | null;
}

interface OpenDivision {
  id: string;
  name: string;
  age_min: number | null;
  age_max: number | null;
  price_cents: number;
  season: {
    id: string;
    name: string;
    status: string;
    age_cutoff_date: string | null;
    organization: { id: string; name: string };
  };
}

const STATUS_BADGE: Record<string, string> = {
  confirmed: 'active',
  pending: 'pending',
  waitlisted: 'pending',
  canceled: 'canceled',
};

export default function DashboardClient({
  household,
  registrations,
  openDivisions,
}: {
  household: HouseholdMember[];
  registrations: Registration[];
  openDivisions: OpenDivision[];
}) {
  const router = useRouter();
  const [members, setMembers] = useState(household);
  const [showAddForm, setShowAddForm] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dob, setDob] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAddMember(e: React.FormEvent) {
    e.preventDefault();
    setAdding(true);
    setError(null);
    try {
      const result = await addHouseholdMember({ firstName, lastName, dob });
      if ('error' in result) {
        setError(result.error);
        return;
      }
      setMembers((prev) => [...prev, { id: result.personId, first_name: firstName, last_name: lastName, dob, isSelf: false }]);
      setFirstName('');
      setLastName('');
      setDob('');
      setShowAddForm(false);
      router.refresh();
    } catch (err: any) {
      setError(err.message ?? 'Something went wrong.');
    } finally {
      setAdding(false);
    }
  }

  function registrationsFor(personId: string): Registration[] {
    return registrations.filter((r) => r.person_id === personId);
  }

  function alreadyRegistered(personId: string, seasonId: string): boolean {
    return registrations.some(
      (r) =>
        r.person_id === personId &&
        r.season?.id === seasonId &&
        r.registration_type === 'player' &&
        ['pending', 'confirmed', 'waitlisted'].includes(r.status)
    );
  }

  return (
    <div>
      {error && <p style={{ color: '#B23A2E', marginBottom: 12 }}>{error}</p>}

      <div className="form-card" style={{ marginBottom: 32 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>Household</h2>
          <button onClick={() => setShowAddForm((s) => !s)} className="btn-small">
            {showAddForm ? 'Cancel' : '+ Add a player'}
          </button>
        </div>

        {showAddForm && (
          <form onSubmit={handleAddMember} style={{ marginTop: 16 }}>
            <div style={{ display: 'flex', gap: 12 }}>
              <input
                placeholder="First name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="form-input"
                required
              />
              <input
                placeholder="Last name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="form-input"
                required
              />
            </div>
            <label className="form-label">Date of birth</label>
            <input type="date" value={dob} onChange={(e) => setDob(e.target.value)} className="form-input" required />
            <button type="submit" disabled={adding} className="btn-primary" style={{ width: '100%' }}>
              {adding ? 'Adding…' : 'Add player to household'}
            </button>
          </form>
        )}

        <div className="data-table-card" style={{ marginTop: 16 }}>
          {members.map((m) => {
            const regs = registrationsFor(m.id);
            return (
              <div key={m.id} className="data-row" style={{ alignItems: 'flex-start' }}>
                <div>
                  <div className="data-row-name">
                    {m.first_name} {m.last_name} {m.isSelf && <span style={{ color: 'var(--gray)', fontWeight: 400 }}>(you)</span>}
                  </div>
                  <div className="data-row-meta">{m.dob ? `Born ${new Date(m.dob).toLocaleDateString()}` : 'No date of birth on file'}</div>
                  {regs.length > 0 && (
                    <div style={{ marginTop: 8 }}>
                      {regs.map((r) => (
                        <div key={r.id} style={{ fontSize: 13, marginTop: 4 }}>
                          <span className={`status-badge ${STATUS_BADGE[r.status] ?? ''}`}>{r.status}</span>{' '}
                          {r.registration_type} — {r.division?.name ?? r.season?.name}
                          {r.season?.organization?.name ? ` (${r.season.organization.name})` : ''}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="form-card">
        <h2 style={{ marginTop: 0 }}>Open for registration</h2>
        {openDivisions.length === 0 && <p style={{ color: 'var(--gray)' }}>Nothing is open for registration right now.</p>}

        {openDivisions.length > 0 && (
          <div className="data-table-card" style={{ marginTop: 16 }}>
            {openDivisions.map((d) => (
              <div key={d.id} className="data-row" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <div>
                  <div className="data-row-name">
                    {d.name} <span style={{ fontWeight: 400, color: 'var(--gray)' }}>— {d.season.organization.name}</span>
                  </div>
                  <div className="data-row-meta">
                    {d.season.name}
                    {d.age_min && d.age_max ? ` · Ages ${d.age_min}–${d.age_max}` : ''} ·{' '}
                    {d.price_cents > 0 ? `$${(d.price_cents / 100).toFixed(2)}` : 'Free'}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
                  {members.map((m) => {
                    const registered = alreadyRegistered(m.id, d.season.id);
                    const eligible = isEligibleForDivision(m.dob, d.season.age_cutoff_date, d.age_min, d.age_max);
                    return (
                      <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 12, color: 'var(--gray)' }}>
                          {m.first_name}
                          {!eligible ? ' (outside age range)' : ''}
                        </span>
                        {registered ? (
                          <span className="status-badge active">registered</span>
                        ) : (
                          <Link href={`/register/${d.id}?personId=${m.id}`} className="btn-small" style={{ textDecoration: 'none' }}>
                            Register
                          </Link>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
