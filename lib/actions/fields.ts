'use server';

// lib/actions/fields.ts
//
// Organization-level registry of physical field/court names (migration
// 0016). Season Builder's field picker reads from this list instead of
// letting each division free-type its own — see that migration's comment
// for why a shared, consistently-spelled list is what makes
// generateSeasonSchedule()'s cross-division conflict check actually catch
// collisions instead of missing them over a casing/spelling mismatch.

import { createAdminClient } from '@/lib/supabase/admin';
import { requireOrgPermission } from '@/lib/org-context';

type CreateFieldResult = { id: string; name: string } | { error: string };

export async function createField(organizationId: string, name: string): Promise<CreateFieldResult> {
  try {
    const authorized = await requireOrgPermission(organizationId, 'manage_schedule');
    if (!authorized) {
      return { error: 'You do not have permission to add a field.' };
    }

    const trimmed = name.trim();
    if (!trimmed) {
      return { error: 'Field name is required.' };
    }

    const admin = createAdminClient();

    // Case-insensitive duplicate check — the whole point of this table is
    // to stop "Field 1" / "field 1" from being treated as two different
    // fields, so don't let that split happen at creation time either.
    const { data: existing } = await admin
      .from('fields')
      .select('id, name')
      .eq('organization_id', organizationId)
      .ilike('name', trimmed);

    if (existing && existing.length > 0) {
      return { id: existing[0].id, name: existing[0].name };
    }

    const { data, error } = await admin
      .from('fields')
      .insert({ organization_id: organizationId, name: trimmed })
      .select('id, name')
      .single();

    if (error || !data) {
      return { error: `Failed to add field: ${error?.message}` };
    }

    return { id: data.id, name: data.name };
  } catch (err) {
    return {
      error: err instanceof Error ? `Unexpected server error: ${err.message}` : 'Unexpected server error.',
    };
  }
}

type DeleteFieldResult = { ok: true } | { error: string };

export async function deleteField(organizationId: string, fieldId: string): Promise<DeleteFieldResult> {
  try {
    const authorized = await requireOrgPermission(organizationId, 'manage_schedule');
    if (!authorized) {
      return { error: 'You do not have permission to remove a field.' };
    }

    const admin = createAdminClient();
    const { error } = await admin
      .from('fields')
      .delete()
      .eq('id', fieldId)
      .eq('organization_id', organizationId);

    if (error) {
      return { error: `Failed to remove field: ${error.message}` };
    }

    return { ok: true };
  } catch (err) {
    return {
      error: err instanceof Error ? `Unexpected server error: ${err.message}` : 'Unexpected server error.',
    };
  }
}
