'use client';

// app/admin/members/members-manager.tsx
//
// Add a member by email, remove a role, and toggle delegated permissions
// (see lib/actions/members.ts / 0022_delegated_permissions.sql). Each
// member's checkbox row saves independently so one person's change can't
// be lost by another admin editing a different row at the same time.

import { useState } from 'react';
import {
  addMember,
  removeMemberRole,
  setMemberPermissions,
  type OrgMemberRow,
} from '@/lib/actions/members';
import { ALL_ORG_PERMISSIONS, type OrgPermission, type OrgRole } from '@/lib/org-context';

const ROLE_OPTIONS: OrgRole[] = ['admin', 'coach', 'volunteer', 'parent', 'player'];

export default function MembersManager({
  organizationId,
  initialMembers,
}: {
  organizationId: string;
  initialMembers: OrgMemberRow[];
}) {
  const [members, setMembers] = useState(initialMembers);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<OrgRole>('volunteer');
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setAdding(true);
    setAddError(null);
    const result = await addMember({ organizationId, email, role });
    setAdding(false);
    if ('error' in result) {
      setAddError(result.error);
      return;
    }
    setEmail('');
    // Simplest correct refresh: refetch isn't wired up here, so just
    // reload — the new member's row (with their real name) needs a
    // server round trip anyway since we only have their email client-side.
    window.location.reload();
  }

  return (
    <div>
      <form onSubmit={handleAdd} className="form-card" style={{ maxWidth: 480, marginBottom: 32 }}>
        <label className="form-label">Add a member</label>
        <p style={{ fontSize: 12, color: 'var(--gray)', marginTop: 0, marginBottom: 12 }}>
          They need a leago account already (any signup or registration works) — enter the email they used.
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="form-input"
            style={{ marginBottom: 0, flex: 1 }}
            placeholder="email@example.com"
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as OrgRole)}
            className="form-input"
            style={{ marginBottom: 0, width: 140 }}
          >
            {ROLE_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {r[0].toUpperCase() + r.slice(1)}
              </option>
            ))}
          </select>
          <button type="submit" className="btn-primary" disabled={adding}>
            {adding ? 'Adding…' : 'Add'}
          </button>
        </div>
        {addError && (
          <p style={{ color: '#B23A2E', fontSize: 14, marginTop: 8, marginBottom: 0 }}>{addError}</p>
        )}
      </form>

      {members.length === 0 ? (
        <div className="empty-state">
          <p>No members yet besides you.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {members.map((member) => (
            <MemberRow
              key={member.personId}
              organizationId={organizationId}
              member={member}
              onRemoveRole={(role) =>
                setMembers((prev) =>
                  prev
                    .map((m) =>
                      m.personId === member.personId ? { ...m, roles: m.roles.filter((r) => r !== role) } : m
                    )
                    .filter((m) => m.roles.length > 0)
                )
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

function MemberRow({
  organizationId,
  member,
  onRemoveRole,
}: {
  organizationId: string;
  member: OrgMemberRow;
  onRemoveRole: (role: OrgRole) => void;
}) {
  const isAdmin = member.roles.includes('admin');
  const [permissions, setPermissions] = useState<OrgPermission[]>(member.permissions);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [removing, setRemoving] = useState<OrgRole | null>(null);

  async function togglePermission(permission: OrgPermission) {
    const next = permissions.includes(permission)
      ? permissions.filter((p) => p !== permission)
      : [...permissions, permission];
    setPermissions(next);
    setSaving(true);
    setError(null);
    setSaved(false);
    const result = await setMemberPermissions(organizationId, member.personId, next);
    setSaving(false);
    if ('error' in result) {
      setError(result.error);
      setPermissions(permissions); // revert
      return;
    }
    setSaved(true);
  }

  async function handleRemoveRole(role: OrgRole) {
    if (!confirm(`Remove the "${role}" role from ${member.firstName} ${member.lastName}?`)) return;
    setRemoving(role);
    setError(null);
    const result = await removeMemberRole(organizationId, member.personId, role);
    setRemoving(null);
    if ('error' in result) {
      setError(result.error);
      return;
    }
    onRemoveRole(role);
  }

  return (
    <div className="form-card" style={{ maxWidth: 640 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <strong>
            {member.firstName} {member.lastName}
          </strong>
          {member.email && (
            <span style={{ color: 'var(--gray)', fontSize: 13, marginLeft: 8 }}>{member.email}</span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {member.roles.map((r) => (
            <span
              key={r}
              className="btn-small"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'default' }}
            >
              {r}
              <button
                type="button"
                onClick={() => handleRemoveRole(r)}
                disabled={removing === r}
                title={`Remove ${r} role`}
                style={{
                  border: 'none',
                  background: 'none',
                  cursor: 'pointer',
                  color: 'var(--gray)',
                  padding: 0,
                  lineHeight: 1,
                }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      </div>

      {isAdmin ? (
        <p style={{ fontSize: 13, color: 'var(--gray)', marginBottom: 0, marginTop: 12 }}>
          Full admin — already has access to everything below.
        </p>
      ) : (
        <div style={{ marginTop: 12 }}>
          <p style={{ fontSize: 13, color: 'var(--gray)', marginTop: 0, marginBottom: 8 }}>
            Delegated permissions — what this person can manage without being a full admin:
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 6 }}>
            {ALL_ORG_PERMISSIONS.map(({ key, label }) => (
              <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 }}>
                <input
                  type="checkbox"
                  checked={permissions.includes(key)}
                  onChange={() => togglePermission(key)}
                  disabled={saving}
                />
                {label}
              </label>
            ))}
          </div>
          {saving && <p style={{ fontSize: 12, color: 'var(--gray)', marginBottom: 0 }}>Saving…</p>}
          {saved && !saving && <p style={{ fontSize: 12, color: 'var(--green-dark)', marginBottom: 0 }}>Saved</p>}
        </div>
      )}
      {error && <p style={{ color: '#B23A2E', fontSize: 13, marginTop: 8, marginBottom: 0 }}>{error}</p>}
    </div>
  );
}
