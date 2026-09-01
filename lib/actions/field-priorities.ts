'use server';

// lib/actions/field-priorities.ts
//
// Per-field division priority ranking (migration 0018) — see that
// migration's comment for the full model. Read by generateSeasonSchedule()
// to reserve a field for a higher-priority division until it's actually
// been scheduled there.
//
// Returns { error } instead of throwing, and wraps the whole body in a
// try/catch — see the comment in lib/actions/onboarding.ts for why.

import { createAdminClient } from '@/lib/supabase/admin';
import { requireOrgAdmin } from '@/lib/org-context';

type SetFieldPriorityResult = { ok: true } | { error: string };

/** Upserts this division's priority (1 = highest) for this field. Called
 * from both the Fields panel (field-centric editing) and a division row
 * (division-centric editing) — same underlying row either way. */
export async function setFieldPriority(
  organizationId: string,
  fieldId: string,
  divisionId: string,
  priority: number
): Promise<SetFieldPriorityResult> {
  try {
    const isAdmin = await requireOrgAdmin(organizationId);
    if (!isAdmin) {
      return { error: 'Only an organization admin can set field priority.' };
    }

    if (!Number.isFinite(priority) || priority < 1) {
      return { error: 'Priority must be a number of at least 1.' };
    }

    const admin = createAdminClient();

    // Defense in depth: requireOrgAdmin only checked the caller-supplied
    // organizationId, which the client controls — confirm the field and
    // division being linked actually belong to that org before writing,
    // since the admin client bypasses RLS.
    const { data: field } = await admin
      .from('fields')
      .select('id, organization_id')
      .eq('id', fieldId)
      .single();

    if (!field || field.organization_id !== organizationId) {
      return { error: 'Field not found for this organization.' };
    }

    const { data: division } = await admin
      .from('divisions')
      .select('id, seasons ( organization_id )')
      .eq('id', divisionId)
      .single();

    const divisionOrgId = (division?.seasons as any)?.organization_id;
    if (!division || divisionOrgId !== organizationId) {
      return { error: 'Division not found for this organization.' };
    }

    const { error } = await admin
      .from('field_priorities')
      .upsert(
        { organization_id: organizationId, field_id: fieldId, division_id: divisionId, priority },
        { onConflict: 'field_id,division_id' }
      );

    if (error) {
      return { error: `Failed to set priority: ${error.message}` };
    }

    return { ok: true };
  } catch (err) {
    return {
      error: err instanceof Error ? `Unexpected server error: ${err.message}` : 'Unexpected server error.',
    };
  }
}

type RemoveFieldPriorityResult = { ok: true } | { error: string };

export async function removeFieldPriority(
  organizationId: string,
  fieldId: string,
  divisionId: string
): Promise<RemoveFieldPriorityResult> {
  try {
    const isAdmin = await requireOrgAdmin(organizationId);
    if (!isAdmin) {
      return { error: 'Only an organization admin can remove a field priority.' };
    }

    const admin = createAdminClient();
    const { error } = await admin
      .from('field_priorities')
      .delete()
      .eq('organization_id', organizationId)
      .eq('field_id', fieldId)
      .eq('division_id', divisionId);

    if (error) {
      return { error: `Failed to remove priority: ${error.message}` };
    }

    return { ok: true };
  } catch (err) {
    return {
      error: err instanceof Error ? `Unexpected server error: ${err.message}` : 'Unexpected server error.',
    };
  }
}
