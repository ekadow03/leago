'use server';

// lib/actions/household.ts
//
// A "household" is the logged-in user's own person row plus any dependents
// (typically minor children with no login of their own) linked via the
// guardians table — see 0020_registration_and_household.sql for why that's
// a separate table rather than reusing organization_members.guardian_of.
//
// Returns { error } instead of throwing — see the comment in
// lib/actions/onboarding.ts for why.

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

interface AddHouseholdMemberInput {
  firstName: string;
  lastName: string;
  dob: string; // YYYY-MM-DD
}

type AddHouseholdMemberResult = { personId: string } | { error: string };

export async function addHouseholdMember(
  input: AddHouseholdMemberInput
): Promise<AddHouseholdMemberResult> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { error: 'Must be logged in to add a household member.' };
    }

    const { data: guardianPerson } = await supabase
      .from('people')
      .select('id')
      .eq('auth_user_id', user.id)
      .single();

    if (!guardianPerson) {
      return { error: 'No profile found for your account.' };
    }

    const firstName = input.firstName.trim();
    const lastName = input.lastName.trim();

    if (!firstName || !lastName) {
      return { error: 'First and last name are required.' };
    }
    if (!input.dob) {
      return { error: 'Date of birth is required.' };
    }
    if (new Date(input.dob).getTime() > Date.now()) {
      return { error: 'Date of birth cannot be in the future.' };
    }

    const admin = createAdminClient();

    const { data: dependent, error: personError } = await admin
      .from('people')
      .insert({
        first_name: firstName,
        last_name: lastName,
        dob: input.dob,
      })
      .select('id')
      .single();

    if (personError || !dependent) {
      return { error: `Failed to add player: ${personError?.message}` };
    }

    const { error: guardianError } = await admin.from('guardians').insert({
      guardian_person_id: guardianPerson.id,
      dependent_person_id: dependent.id,
    });

    if (guardianError) {
      // Roll back the orphaned people row rather than leaving a dependent
      // no one can see or manage.
      await admin.from('people').delete().eq('id', dependent.id);
      return { error: `Failed to link player to your account: ${guardianError.message}` };
    }

    return { personId: dependent.id };
  } catch (err) {
    return {
      error: err instanceof Error ? `Unexpected server error: ${err.message}` : 'Unexpected server error.',
    };
  }
}
