'use server';

// lib/actions/evaluations.ts
// Evaluation scoring — admin/evaluator only. See 0007_evaluations_and_draft.sql
// for why this is intentionally never readable by players/parents.

import { createAdminClient } from '@/lib/supabase/admin';
import { requireOrgAdmin } from '@/lib/org-context';
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
  const isAdmin = await requireOrgAdmin(input.organizationId);
  if (!isAdmin) {
    throw new Error('Only an organization admin can record evaluations.');
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