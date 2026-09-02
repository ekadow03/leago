'use client';

// app/admin/teams/[teamId]/team-roster.tsx
//
// Players are read-only here (they land on a team via the draft — see
// lib/actions/draft.ts — reassigning them post-draft isn't wired up
// yet). Staff (head/assistant coach, volunteer) is fully managed here.

import { useState } from 'react';
import { addTeamStaff, removeTeamStaff, type TeamStaffRole, type TeamStaffRow } from '@/lib/actions/team-staff';
import type { OrgMemberRow } from '@/lib/actions/members';

interface Player {
  registrationId: string;
  personId: string;
  firstName: string;
  lastName: string;
  jerseyNumber: string | null;
  status: string;
}

const ROLE_LABELS: Record<TeamStaffRole, string> = {
  head_coach: 'Head coach',
  assistant_coach: 'Assistant coach',
  volunteer: 'Volunteer',
};

export default function TeamRoster({
  organizationId,
  teamId,
  initialPlayers,
  initialStaff,
  orgMembers,
}: {
  organizationId: string;
  teamId: string;
  initialPlayers: Player[];
  initialStaff: TeamStaffRow[];
  orgMembers: OrgMemberRow[];
}) {
  const [staff, setStaff] = useState(initialStaff);
  const [selectedPersonId, setSelectedPersonId] = useState('');
  const [role, setRole] = useState<TeamStaffRole>('assistant_coach');
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const staffedPersonIds = new Set(staff.map((s) => s.personId));
  const availableMembers = orgMembers.filter((m) => !staffedPersonIds.has(m.personId));

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedPersonId) return;
    setAdding(true);
    setError(null);
    const result = await addTeamStaff(organizationId, teamId, selectedPersonId, role);
    setAdding(false);
    if ('error' in result) {
      setError(result.error);
      return;
    }
    const member = orgMembers.find((m) => m.personId === selectedPersonId);
    if (member) {
      setStaff((prev) => [
        ...prev,
        { id: `${selectedPersonId}-${role}`, personId: selectedPersonId, firstName: member.firstName, lastName: member.lastName, role },
      ]);
    }
    setSelectedPersonId('');
  }

  async function handleRemove(row: TeamStaffRow) {
    if (!confirm(`Remove ${row.firstName} ${row.lastName} (${ROLE_LABELS[row.role]}) from this team?`)) return;
    setRemovingId(row.id);
    setError(null);
    const result = await removeTeamStaff(organizationId, teamId, row.id);
    setRemovingId(null);
    if ('error' in result) {
      setError(result.error);
      return;
    }
    setStaff((prev) => prev.filter((s) => s.id !== row.id));
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32, maxWidth: 640 }}>
      <div>
        <h2>Coaching staff</h2>
        {staff.length === 0 ? (
          <p style={{ color: 'var(--gray)' }}>No coaches or volunteers assigned yet.</p>
        ) : (
          <div className="chip-list" style={{ marginBottom: 12 }}>
            {staff.map((s) => (
              <span key={s.id} className="chip">
                {s.firstName} {s.lastName} — {ROLE_LABELS[s.role]}
                <button type="button" onClick={() => handleRemove(s)} disabled={removingId === s.id}>
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        {error && <p style={{ color: '#B23A2E', fontSize: 14 }}>{error}</p>}

        <form onSubmit={handleAdd} className="add-chip-row">
          <select
            value={selectedPersonId}
            onChange={(e) => setSelectedPersonId(e.target.value)}
            className="form-input"
            style={{ minWidth: 200 }}
          >
            <option value="">Select a member…</option>
            {availableMembers.map((m) => (
              <option key={m.personId} value={m.personId}>
                {m.firstName} {m.lastName}
                {m.email ? ` (${m.email})` : ''}
              </option>
            ))}
          </select>
          <select value={role} onChange={(e) => setRole(e.target.value as TeamStaffRole)} className="form-input" style={{ width: 160 }}>
            <option value="head_coach">Head coach</option>
            <option value="assistant_coach">Assistant coach</option>
            <option value="volunteer">Volunteer</option>
          </select>
          <button type="submit" disabled={adding || !selectedPersonId} className="btn-small">
            {adding ? 'Adding…' : '+ Add'}
          </button>
        </form>
        {availableMembers.length === 0 && (
          <p style={{ fontSize: 12, color: 'var(--gray)', marginTop: 8 }}>
            Everyone in your organization is already on this team&apos;s staff, or your org has no other members yet
            — add people from the{' '}
            <a href="/admin/members" style={{ color: 'var(--green-dark)' }}>
              Members
            </a>{' '}
            page first.
          </p>
        )}
      </div>

      <div>
        <h2>Players ({initialPlayers.length})</h2>
        {initialPlayers.length === 0 ? (
          <p style={{ color: 'var(--gray)' }}>No players drafted onto this team yet.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
                <th style={{ padding: '6px 8px' }}>Name</th>
                <th style={{ padding: '6px 8px' }}>#</th>
                <th style={{ padding: '6px 8px' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {initialPlayers.map((p) => (
                <tr key={p.registrationId} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '6px 8px' }}>
                    {p.firstName} {p.lastName}
                  </td>
                  <td style={{ padding: '6px 8px' }}>{p.jerseyNumber ?? '—'}</td>
                  <td style={{ padding: '6px 8px' }}>{p.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
