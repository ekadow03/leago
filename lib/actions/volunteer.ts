'use server';

// lib/actions/volunteer.ts

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireOrgAdmin } from '@/lib/org-context';

interface CreateShiftInput {
  organizationId: string;
  eventId: string;
  role: string;
  slotsTotal: number;
  notes?: string;
}

export async function createVolunteerShift(input: CreateShiftInput): Promise<{ id: string }> {
  const isAdmin = await requireOrgAdmin(input.organizationId);
  if (!isAdmin) {
    throw new Error('Only an organization admin can create volunteer shifts.');
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('volunteer_shifts')
    .insert({
      event_id: input.eventId,
      role: input.role,
      slots_total: input.slotsTotal,
      notes: input.notes ?? null,
    })
    .select('id')
    .single();

  if (error || !data) {
    throw new Error(`Failed to create shift: ${error?.message}`);
  }

  return { id: data.id };
}

export async function signUpForShift(shiftId: string): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('Must be logged in to sign up.');
  }

  const { data: person } = await supabase
    .from('people')
    .select('id')
    .eq('auth_user_id', user.id)
    .single();

  if (!person) {
    throw new Error('No profile found for your account.');
  }

  const admin = createAdminClient();

  const { data: shift } = await admin
    .from('volunteer_shifts')
    .select('id, slots_total')
    .eq('id', shiftId)
    .single();

  if (!shift) {
    throw new Error('Shift not found.');
  }

  const { count } = await admin
    .from('volunteer_signups')
    .select('id', { count: 'exact', head: true })
    .eq('shift_id', shiftId);

  if ((count ?? 0) >= shift.slots_total) {
    throw new Error('This shift is already full.');
  }

  const { error } = await admin.from('volunteer_signups').insert({
    shift_id: shiftId,
    person_id: person.id,
  });

  if (error) {
    if (error.code === '23505') {
      throw new Error("You're already signed up for this shift.");
    }
    throw new Error(`Failed to sign up: ${error.message}`);
  }
}

export async function cancelSignup(signupId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from('volunteer_signups').delete().eq('id', signupId);

  if (error) {
    throw new Error(`Failed to cancel signup: ${error.message}`);
  }
}