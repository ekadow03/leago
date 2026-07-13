// app/volunteer/volunteer-list.tsx
'use client';

import { useState } from 'react';
import { signUpForShift, cancelSignup, createVolunteerShift } from '@/lib/actions/volunteer';

interface EventRow {
  id: string;
  title: string;
  type: string;
  start_time: string;
  status: string;
}

interface ShiftRow {
  id: string;
  event_id: string;
  role: string;
  slots_total: number;
  notes: string | null;
}

interface SignupRow {
  id: string;
  shift_id: string;
  person_id: string;
  people: { first_name: string; last_name: string };
}

export default function VolunteerList({
  organizationId,
  isAdmin,
  currentPersonId,
  events,
  shifts: initialShifts,
  signups: initialSignups,
}: {
  organizationId: string;
  organizationName: string;
  isAdmin: boolean;
  currentPersonId: string;
  events: EventRow[];
  shifts: ShiftRow[];
  signups: SignupRow[];
}) {
  const [shifts, setShifts] = useState(initialShifts);
  const [signups, setSignups] = useState(initialSignups);
  const [error, setError] = useState<string | null>(null);
  const [busyShiftId, setBusyShiftId] = useState<string | null>(null);
  const [addingShiftFor, setAddingShiftFor] = useState<string | null>(null);

  async function handleSignUp(shiftId: string) {
    setBusyShiftId(shiftId);
    setError(null);
    try {
      await signUpForShift(shiftId);
      setSignups((prev) => [
        ...prev,
        { id: 'pending-refresh', shift_id: shiftId, person_id: currentPersonId, people: { first_name: 'You', last_name: '' } },
      ]);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusyShiftId(null);
    }
  }

  async function handleCancel(signupId: string, shiftId: string) {
    setBusyShiftId(shiftId);
    setError(null);
    try {
      await cancelSignup(signupId);
      setSignups((prev) => prev.filter((s) => s.id !== signupId));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusyShiftId(null);
    }
  }

  async function handleAddShift(eventId: string, role: string, slotsTotal: number) {
    setError(null);
    try {
      const result = await createVolunteerShift({ organizationId, eventId, role, slotsTotal });
      setShifts((prev) => [...prev, { id: result.id, event_id: eventId, role, slots_total: slotsTotal, notes: null }]);
      setAddingShiftFor(null);
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <div>
      {error && <p style={{ color: '#B23A2E', marginBottom: 12 }}>{error}</p>}

      {events.length === 0 && <p style={{ color: 'var(--gray)' }}>No events scheduled yet.</p>}

      {events.map((ev) => {
        const eventShifts = shifts.filter((s) => s.event_id === ev.id);

        return (
          <div key={ev.id} className="list-item-card">
            <h3>{ev.title}</h3>
            <p style={{ fontSize: 13, color: 'var(--gray)', margin: '0 0 8px' }}>
              {new Date(ev.start_time).toLocaleString()}
            </p>

            {eventShifts.map((shift) => {
              const shiftSignups = signups.filter((s) => s.shift_id === shift.id);
              const isFull = shiftSignups.length >= shift.slots_total;
              const alreadySignedUp = shiftSignups.some((s) => s.person_id === currentPersonId);
              const mySignup = shiftSignups.find((s) => s.person_id === currentPersonId);

              return (
                <div key={shift.id} className="shift-row">
                  <div>
                    <strong>{shift.role}</strong>{' '}
                    <span style={{ fontSize: 13, color: 'var(--gray)' }}>
                      ({shiftSignups.length}/{shift.slots_total} filled)
                    </span>
                    {shiftSignups.length > 0 && (
                      <div style={{ fontSize: 13, color: 'var(--gray)' }}>
                        {shiftSignups.map((s) => `${s.people.first_name} ${s.people.last_name}`).join(', ')}
                      </div>
                    )}
                  </div>
                  {alreadySignedUp ? (
                    <button onClick={() => mySignup && handleCancel(mySignup.id, shift.id)} disabled={busyShiftId === shift.id} className="btn-small">
                      Cancel
                    </button>
                  ) : (
                    <button onClick={() => handleSignUp(shift.id)} disabled={isFull || busyShiftId === shift.id} className="btn-small">
                      {isFull ? 'Full' : busyShiftId === shift.id ? 'Signing up…' : 'Sign up'}
                    </button>
                  )}
                </div>
              );
            })}

            {isAdmin && (
              <div style={{ marginTop: 12 }}>
                {addingShiftFor === ev.id ? (
                  <AddShiftForm onSubmit={(role, slots) => handleAddShift(ev.id, role, slots)} onCancel={() => setAddingShiftFor(null)} />
                ) : (
                  <button onClick={() => setAddingShiftFor(ev.id)} className="btn-small">
                    + Add volunteer shift
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function AddShiftForm({ onSubmit, onCancel }: { onSubmit: (role: string, slots: number) => void; onCancel: () => void }) {
  const [role, setRole] = useState('');
  const [slots, setSlots] = useState('1');

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <input placeholder="Role (e.g. Concession stand)" value={role} onChange={(e) => setRole(e.target.value)} className="form-input" style={{ marginBottom: 0, fontSize: 13 }} />
      <input type="number" min={1} value={slots} onChange={(e) => setSlots(e.target.value)} className="form-input" style={{ width: 60, marginBottom: 0, fontSize: 13 }} />
      <button onClick={() => role && onSubmit(role, parseInt(slots, 10))} className="btn-small">Add</button>
      <button onClick={onCancel} className="btn-small">Cancel</button>
    </div>
  );
}
