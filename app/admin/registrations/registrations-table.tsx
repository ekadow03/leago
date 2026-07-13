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
      <div style={{ marginBottom: 16 }}>
        {(['all', 'pending', 'confirmed', 'waitlisted', 'canceled'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            style={{
              marginRight: 8,
              fontWeight: filter === s ? 700 : 400,
              textDecoration: filter === s ? 'underline' : 'none',
            }}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {refundError && <p style={{ color: 'red' }}>{refundError}</p>}

      {filtered.length === 0 && <p style={{ color: '#666' }}>No registrations match this filter.</p>}

      {filtered.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '2px solid #ddd' }}>
              <th style={{ padding: 8 }}>Name</th>
              <th style={{ padding: 8 }}>Type</th>
              <th style={{ padding: 8 }}>Season</th>
              <th style={{ padding: 8 }}>Status</th>
              <th style={{ padding: 8 }}>Payment</th>
              <th style={{ padding: 8 }}>Amount</th>
              <th style={{ padding: 8 }}>Registered</th>
              <th style={{ padding: 8 }}></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const remaining = r.amount_cents - r.refunded_amount_cents;
              const canRefund = r.payment_status === 'paid' || r.payment_status === 'partially_refunded';

              return (
                <tr key={r.id} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={{ padding: 8 }}>
                    {r.person?.first_name} {r.person?.last_name}
                    <div style={{ fontSize: 12, color: '#999' }}>{r.person?.email}</div>
                  </td>
                  <td style={{ padding: 8 }}>{r.registration_type}</td>
                  <td style={{ padding: 8 }}>{r.season?.name}</td>
                  <td style={{ padding: 8 }}>{r.status}</td>
                  <td style={{ padding: 8 }}>
                    {r.payment_status}
                    {r.refunded_amount_cents > 0 && (
                      <div style={{ fontSize: 12, color: '#999' }}>
                        ${(r.refunded_amount_cents / 100).toFixed(2)} refunded
                      </div>
                    )}
                  </td>
                  <td style={{ padding: 8 }}>${(r.amount_cents / 100).toFixed(2)}</td>
                  <td style={{ padding: 8, fontSize: 13, color: '#666' }}>
                    {new Date(r.created_at).toLocaleDateString()}
                  </td>
                  <td style={{ padding: 8 }}>
                    {canRefund && remaining > 0 && (
                      <button
                        onClick={() => handleRefund(r)}
                        disabled={refundingId === r.id}
                        style={{ fontSize: 13 }}
                      >
                        {refundingId === r.id ? 'Refunding…' : 'Refund'}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}