// app/admin/registrations/registrations-table.tsx
'use client';

import { useState } from 'react';
import { issueRefund } from '@/lib/actions/refunds';

interface Registration {
  id: string;
  registration_type: string;
  status: string;
  payment_status: string;
  amount_cents: number;
  refunded_amount_cents: number;
  created_at: string;
  stripe_payment_intent_id: string | null;
  person: { first_name: string; last_name: string; email: string | null } | null;
  season: { name: string } | null;
}

type StatusFilter = 'all' | 'pending' | 'confirmed' | 'waitlisted' | 'canceled';

export default function RegistrationsTable({
  initialRegistrations,
}: {
  initialRegistrations: Registration[];
}) {
  const [registrations, setRegistrations] = useState(initialRegistrations);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [refundingId, setRefundingId] = useState<string | null>(null);
  const [refundError, setRefundError] = useState<string | null>(null);

  const filtered =
    filter === 'all' ? registrations : registrations.filter((r) => r.status === filter);

  async function handleRefund(reg: Registration) {
    const remaining = reg.amount_cents - reg.refunded_amount_cents;
    if (remaining <= 0) {
      alert('Nothing left to refund on this registration.');
      return;
    }

    const input = prompt(
      `Refund amount for ${reg.person?.first_name} ${reg.person?.last_name} (max $${(remaining / 100).toFixed(2)}):`,
      (remaining / 100).toFixed(2)
    );
    if (!input) return;

    const amountCents = Math.round(parseFloat(input) * 100);
    if (isNaN(amountCents) || amountCents <= 0 || amountCents > remaining) {
      alert('Invalid amount.');
      return;
    }

    setRefundingId(reg.id);
    setRefundError(null);

    try {
      await issueRefund({ registrationId: reg.id, amountCents });

      setRegistrations((prev) =>
        prev.map((r) =>
          r.id === reg.id
            ? {
                ...r,
                refunded_amount_cents: r.refunded_amount_cents + amountCents,
                payment_status:
                  r.refunded_amount_cents + amountCents >= r.amount_cents
                    ? 'refunded'
                    : 'partially_refunded',
              }
            : r
        )
      );
    } catch (err: any) {
      setRefundError(`Failed to refund ${reg.person?.first_name} ${reg.person?.last_name}: ${err.message}`);
    } finally {
      setRefundingId(null);
    }
  }

  return (
    <div>
      <div className="filter-row">
        {(['all', 'pending', 'confirmed', 'waitlisted', 'canceled'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`filter-pill ${filter === s ? 'active' : ''}`}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {refundError && <p style={{ color: '#B23A2E', marginBottom: 12 }}>{refundError}</p>}

      {filtered.length === 0 && <p style={{ color: 'var(--gray)' }}>No registrations match this filter.</p>}

      {filtered.length > 0 && (
        <div className="data-table-card">
          {filtered.map((r) => {
            const remaining = r.amount_cents - r.refunded_amount_cents;
            const canRefund = r.payment_status === 'paid' || r.payment_status === 'partially_refunded';

            return (
              <div key={r.id} className="data-row">
                <div>
                  <div className="data-row-name">
                    {r.person?.first_name} {r.person?.last_name}
                  </div>
                  <div className="data-row-meta">
                    {r.person?.email} · {r.registration_type} · {r.season?.name} · $
                    {(r.amount_cents / 100).toFixed(2)}
                    {r.refunded_amount_cents > 0 && ` (${(r.refunded_amount_cents / 100).toFixed(2)} refunded)`}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span className={`status-badge ${r.status}`}>{r.status}</span>
                  <span className={`status-badge ${r.payment_status}`}>{r.payment_status}</span>
                  {canRefund && remaining > 0 && (
                    <button
                      onClick={() => handleRefund(r)}
                      disabled={refundingId === r.id}
                      className="btn-small"
                    >
                      {refundingId === r.id ? 'Refunding…' : 'Refund'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}