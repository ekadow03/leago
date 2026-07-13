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
  organizationName,
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
        {
          id: 'pending-refresh',
          shift_id: shiftId,
          person_id: currentPersonId,
          people: { first_name: 'You', last_name: '' },
        },
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
    <div style={{ maxWidth: 700, margin: '40px auto', fontFamily: 'system-ui', padding: '0 20px' }}>
      <h1>{organizationName} — Volunteer</h1>

      {error && <p style={{ color: 'red' }}>{error}</p>}

      {events.length === 0 && <p style={{ color: '#666' }}>No events scheduled yet.</p>}

      {events.map((ev) => {
        const eventShifts = shifts.filter((s) => s.event_id === ev.id);

        return (
          <div key={ev.id} style={{ marginBottom: 24, borderBottom: '1px solid #eee', paddingBottom: 16 }}>
            <div style={{ fontWeight: 600 }}>{ev.title}</div>
            <div style={{ fontSize: 13, color: '#666', marginBottom: 8 }}>
              {new Date(ev.start_time).toLocaleString()}
            </div>

            {eventShifts.map((shift) => {
              const shiftSignups = signups.filter((s) => s.shift_id === shift.id);
              const isFull = shiftSignups.length >= shift.slots_total;
              const alreadySignedUp = shiftSignups.some((s) => s.person_id === currentPersonId);
              const mySignup = shiftSignups.find((s) => s.person_id === currentPersonId);

              return (
                <div key={shift.id} style={{ padding: '8px 0 8px 16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <strong>{shift.role}</strong>{' '}
                      <span style={{ fontSize: 13, color: '#999' }}>
                        ({shiftSignups.length}/{shift.slots_total} filled)
                      </span>
                      {shiftSignups.length > 0 && (
                        <div style={{ fontSize: 13, color: '#666' }}>
                          {shiftSignups.map((s) => `${s.people.first_name} ${s.people.last_name}`).join(', ')}
                        </div>
                      )}
                    </div>
                    {alreadySignedUp ? (
                      <button
                        onClick={() => mySignup && handleCancel(mySignup.id, shift.id)}
                        disabled={busyShiftId === shift.id}
                        style={{ fontSize: 13 }}
                      >
                        Cancel my signup
                      </button>
                    ) : (
                      <button
                        onClick={() => handleSignUp(shift.id)}
                        disabled={isFull || busyShiftId === shift.id}
                        style={{ fontSize: 13 }}
                      >
                        {isFull ? 'Full' : busyShiftId === shift.id ? 'Signing up…' : 'Sign up'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}

            {isAdmin && (
              <div style={{ paddingLeft: 16, marginTop: 8 }}>
                {addingShiftFor === ev.id ? (
                  <AddShiftForm
                    onSubmit={(role, slots) => handleAddShift(ev.id, role, slots)}
                    onCancel={() => setAddingShiftFor(null)}
                  />
                ) : (
                  <button onClick={() => setAddingShiftFor(ev.id)} style={{ fontSize: 12, color: '#666' }}>
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

function AddShiftForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (role: string, slots: number) => void;
  onCancel: () => void;
}) {
  const [role, setRole] = useState('');
  const [slots, setSlots] = useState('1');

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <input placeholder="Role (e.g. Concession stand)" value={role} onChange={(e) => setRole(e.target.value)} style={{ fontSize: 13 }} />
      <input
        type="number"
        min={1}
        value={slots}
        onChange={(e) => setSlots(e.target.value)}
        style={{ width: 50, fontSize: 13 }}
      />
      <button
        onClick={() => role && onSubmit(role, parseInt(slots, 10))}
        style={{ fontSize: 12 }}
      >
        Add
      </button>
      <button onClick={onCancel} style={{ fontSize: 12 }}>
        Cancel
      </button>
    </div>
  );
}