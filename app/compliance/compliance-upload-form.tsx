// app/compliance/compliance-upload-form.tsx
'use client';

import { useState } from 'react';
import { uploadComplianceDocument } from '@/lib/actions/documents';

interface ComplianceRecord {
  id: string;
  type: string;
  status: string;
  verified_at: string | null;
}

const REQUIREMENT_TYPES = [
  { value: 'birth_certificate', label: 'Birth Certificate' },
  { value: 'coach_cert', label: 'Coach Certification' },
] as const;

export default function ComplianceUploadForm({
  personId,
  organizationId,
  existingRecords,
}: {
  personId: string;
  organizationId: string;
  existingRecords: ComplianceRecord[];
}) {
  const [uploading, setUploading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [records, setRecords] = useState(existingRecords);

  async function handleFileChange(type: 'birth_certificate' | 'coach_cert', e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(type);
    setError(null);

    try {
      await uploadComplianceDocument({ personId, organizationId, type, file });
      setRecords((prev) => {
        const withoutThisType = prev.filter((r) => r.type !== type);
        return [...withoutThisType, { id: 'pending-refresh', type, status: 'submitted', verified_at: null }];
      });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUploading(null);
      e.target.value = '';
    }
  }

  return (
    <div>
      {error && <p style={{ color: '#B23A2E' }}>{error}</p>}

      {REQUIREMENT_TYPES.map(({ value, label }) => {
        const record = records.find((r) => r.type === value);
        const status = record?.status ?? 'not started';
        const badgeClass = status === 'verified' ? 'active' : status === 'rejected' || status === 'expired' ? 'canceled' : status === 'submitted' ? 'pending' : '';

        return (
          <div key={value} className="shift-row">
            <div>
              <strong>{label}</strong>
              <div style={{ marginTop: 2 }}>
                {badgeClass ? <span className={`status-badge ${badgeClass}`}>{status}</span> : <span style={{ fontSize: 13, color: 'var(--gray)' }}>{status}</span>}
              </div>
            </div>

            <label style={{ cursor: 'pointer' }}>
              <span className="btn-small">
                {uploading === value ? 'Uploading…' : record ? 'Re-upload' : 'Upload'}
              </span>
              <input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                onChange={(e) => handleFileChange(value, e)}
                disabled={uploading !== null}
                style={{ display: 'none' }}
              />
            </label>
          </div>
        );
      })}
    </div>
  );
}
