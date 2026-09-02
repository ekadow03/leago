'use server';

// lib/actions/evaluations.ts

import { createAdminClient } from '@/lib/supabase/admin';
import { requireOrgPermission } from '@/lib/org-context';
import { createClient } from '@/lib/supabase/server';

interface RecordEvaluationInput {
  organizationId: string;
  seasonId: string;
  personId: string;
  scores: Record<string, number>;
  overallRating?: number;
  notes?: string;
}

export async function recordEvaluation(input: RecordEvaluationInput): Promise<{ id: string }> {
  const authorized = await requireOrgPermission(input.organizationId, 'manage_evaluations');
  if (!authorized) {
    throw new Error('You do not have permission to record evaluations.');
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: evaluatorPerson } = await supabase
    .from('people')
    .select('id')
    .eq('auth_user_id', user!.id)
    .single();

  if (!evaluatorPerson) {
    throw new Error('No profile found for your account.');
  }

  const admin = createAdminClient();

  const { data, error } = await admin
    .from('evaluations')
    .insert({
      organization_id: input.organizationId,
      season_id: input.seasonId,
      person_id: input.personId,
      evaluator_person_id: evaluatorPerson.id,
      scores: input.scores,
      overall_rating: input.overallRating ?? null,
      notes: input.notes ?? null,
    })
    .select('id')
    .single();

  if (error || !data) {
    throw new Error(`Failed to record evaluation: ${error?.message}`);
  }

  return { id: data.id };
}
