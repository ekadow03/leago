// app/admin/compliance/compliance-review.tsx
'use client';

import { useState } from 'react';
import { reviewComplianceRecord, getDocumentSignedUrl } from '@/lib/actions/compliance';

interface Record {
  id: string;
  type: string;
  status: string;
  review_notes: string | null;
  verified_at: string | null;
  document_id: string | null;
  person: { first_name: string; last_name: string; email: string | null } | null;
  document: { id: string; original_filename: string | null; uploaded_at: string } | null;
}

const TYPE_LABELS: Record<string, string> = {
  birth_certificate: 'Birth Certificate',
  coach_cert: 'Coach Certification',
  background_check: 'Background Check',
};

export default function ComplianceReview({
  organizationId,
  initialRecords,
}: {
  organizationId: string;
  initialRecords: Record[];
}) {
  const [records, setRecords] = useState(initialRecords);
  const [filter, setFilter] = useState<'all' | 'submitted' | 'verified' | 'rejected'>('submitted');
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const filtered = filter === 'all' ? records : records.filter((r) => r.status === filter);

  async function handleView(documentId: string) {
    setError(null);
    try {
      const url = await getDocumentSignedUrl(organizationId, documentId);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleReview(recordId: string, status: 'verified' | 'rejected') {
    if (status === 'rejected') {
      const notes = prompt('Reason for rejection (shown to the family/coach):');
      if (notes === null) return;
      await runReview(recordId, status, notes || undefined);
      return;
    }
    await runReview(recordId, status);
  }

  async function runReview(recordId: string, status: 'verified' | 'rejected', notes?: string) {
    setBusyId(recordId);
    setError(null);
    try {
      await reviewComplianceRecord(organizationId, recordId, status, notes);
      setRecords((prev) =>
        prev.map((r) => (r.id === recordId ? { ...r, status, review_notes: notes ?? null } : r))
      );
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div className="filter-row">
        {(['submitted', 'verified', 'rejected', 'all'] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`filter-pill ${filter === f ? 'active' : ''}`}>
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {error && <p style={{ color: '#B23A2E', marginBottom: 12 }}>{error}</p>}

      {filtered.length === 0 && <p style={{ color: 'var(--gray)' }}>Nothing here.</p>}

      {filtered.length > 0 && (
        <div className="data-table-card">
          {filtered.map((r) => (
            <div key={r.id} className="data-row">
              <div>
                <div className="data-row-name">
                  {r.person?.first_name} {r.person?.last_name}
                </div>
                <div className="data-row-meta">
                  {TYPE_LABELS[r.type] ?? r.type}
                  {r.document?.original_filename && ` · ${r.document.original_filename}`}
                  {r.review_notes && ` · "${r.review_notes}"`}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className={`status-badge ${r.status === 'verified' ? 'confirmed' : r.status === 'rejected' ? 'canceled' : 'pending'}`}>
                  {r.status}
                </span>
                {r.document_id && (
                  <button onClick={() => handleView(r.document_id!)} className="btn-small">
                    View
                  </button>
                )}
                {r.status === 'submitted' && (
                  <>
                    <button
                      onClick={() => handleReview(r.id, 'verified')}
                      disabled={busyId === r.id}
                      className="btn-small"
                      style={{ background: 'rgba(34,197,94,0.15)', color: 'var(--green-dark)' }}
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => handleReview(r.id, 'rejected')}
                      disabled={busyId === r.id}
                      className="btn-small"
                      style={{ background: 'rgba(178,58,46,0.1)', color: '#B23A2E' }}
                    >
                      Reject
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}