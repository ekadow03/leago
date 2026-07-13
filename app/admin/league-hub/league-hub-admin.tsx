// app/admin/league-hub/league-hub-admin.tsx
'use client';

import { useState } from 'react';
import { updateOrgProfile, createAnnouncement, setAnnouncementStatus, deleteAnnouncement } from '@/lib/actions/league-hub';

interface Announcement {
  id: string;
  title: string;
  body: string;
  status: string;
  created_at: string;
}

export default function LeagueHubAdmin({
  organizationId,
  orgSlug,
  currentDescription,
  currentContactEmail,
  currentContactPhone,
  initialAnnouncements,
}: {
  organizationId: string;
  orgSlug: string;
  currentDescription: string;
  currentContactEmail: string;
  currentContactPhone: string;
  initialAnnouncements: Announcement[];
}) {
  return (
    <div>
      <ProfileForm
        organizationId={organizationId}
        orgSlug={orgSlug}
        currentDescription={currentDescription}
        currentContactEmail={currentContactEmail}
        currentContactPhone={currentContactPhone}
      />
      <AnnouncementsManager organizationId={organizationId} initialAnnouncements={initialAnnouncements} />
    </div>
  );
}

function ProfileForm({
  organizationId,
  orgSlug,
  currentDescription,
  currentContactEmail,
  currentContactPhone,
}: {
  organizationId: string;
  orgSlug: string;
  currentDescription: string;
  currentContactEmail: string;
  currentContactPhone: string;
}) {
  const [description, setDescription] = useState(currentDescription);
  const [contactEmail, setContactEmail] = useState(currentContactEmail);
  const [contactPhone, setContactPhone] = useState(currentContactPhone);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setSaved(false);
    try {
      await updateOrgProfile({ organizationId, description, contactEmail, contactPhone });
      setSaved(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="form-card" style={{ marginBottom: 32 }}>
      <h2>League profile</h2>
      <p style={{ fontSize: 13, color: 'var(--gray)', marginTop: -12, marginBottom: 16 }}>
        Shown on your public league hub page at <code>/league/{orgSlug}</code>
      </p>

      <label className="form-label">About</label>
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        className="form-input"
        rows={4}
        placeholder="Tell families a bit about your league…"
      />

      <label className="form-label">Contact email</label>
      <input value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} className="form-input" type="email" />

      <label className="form-label">Contact phone</label>
      <input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} className="form-input" />

      {error && <p style={{ color: '#B23A2E', fontSize: 14 }}>{error}</p>}
      {saved && <p style={{ color: 'var(--green-dark)', fontSize: 14, fontWeight: 600 }}>Saved.</p>}

      <button type="submit" disabled={submitting} className="btn-primary" style={{ width: '100%' }}>
        {submitting ? 'Saving…' : 'Save profile'}
      </button>
    </form>
  );
}

function AnnouncementsManager({
  organizationId,
  initialAnnouncements,
}: {
  organizationId: string;
  initialAnnouncements: Announcement[];
}) {
  const [announcements, setAnnouncements] = useState(initialAnnouncements);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const result = await createAnnouncement(organizationId, title, body);
      setAnnouncements((prev) => [
        { id: result.id, title, body, status: 'draft', created_at: new Date().toISOString() },
        ...prev,
      ]);
      setTitle('');
      setBody('');
      setShowForm(false);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggle(id: string, newStatus: 'draft' | 'published') {
    setError(null);
    try {
      await setAnnouncementStatus(organizationId, id, newStatus);
      setAnnouncements((prev) => prev.map((a) => (a.id === id ? { ...a, status: newStatus } : a)));
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this announcement?')) return;
    setError(null);
    try {
      await deleteAnnouncement(organizationId, id);
      setAnnouncements((prev) => prev.filter((a) => a.id !== id));
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <div>
      <h2 style={{ fontWeight: 800 }}>Announcements</h2>
      {error && <p style={{ color: '#B23A2E', marginBottom: 12 }}>{error}</p>}

      <button onClick={() => setShowForm((s) => !s)} className="btn-small" style={{ marginBottom: 16 }}>
        {showForm ? 'Cancel' : '+ New announcement'}
      </button>

      {showForm && (
        <form onSubmit={handleCreate} className="form-card" style={{ marginBottom: 24 }}>
          <label className="form-label">Title</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="form-input" required />
          <label className="form-label">Body</label>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} className="form-input" rows={4} required />
          <button type="submit" disabled={submitting} className="btn-primary" style={{ width: '100%' }}>
            {submitting ? 'Posting…' : 'Post announcement'}
          </button>
        </form>
      )}

      {announcements.length === 0 && <p style={{ color: 'var(--gray)' }}>No announcements yet.</p>}

      {announcements.length > 0 && (
        <div className="data-table-card">
          {announcements.map((a) => (
            <div key={a.id} className="data-row">
              <div>
                <div className="data-row-name">{a.title}</div>
                <div className="data-row-meta">{a.body.slice(0, 80)}{a.body.length > 80 ? '…' : ''}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className={`status-badge ${a.status === 'published' ? 'confirmed' : 'pending'}`}>{a.status}</span>
                {a.status !== 'published' ? (
                  <button onClick={() => handleToggle(a.id, 'published')} className="btn-small">Publish</button>
                ) : (
                  <button onClick={() => handleToggle(a.id, 'draft')} className="btn-small">Unpublish</button>
                )}
                <button onClick={() => handleDelete(a.id)} className="btn-small">Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}