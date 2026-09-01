'use server';

// lib/actions/team-import.ts
// Bulk team creation from a CSV upload — one row per team name. Keeps
// coach assignment out of scope here (that requires a real person/account,
// which a CSV import can't create safely) — teams come in with no coach
// assigned, same as if created one at a time via the existing UI.
//
// Returns { error } instead of throwing, and wraps the whole body in a
// try/catch — see the comment in lib/actions/onboarding.ts for why.

import { createAdminClient } from '@/lib/supabase/admin';
import { requireOrgAdmin } from '@/lib/org-context';

type BulkCreateTeamsResult = { count: number } | { error: string };

export async function bulkCreateTeams(
  organizationId: string,
  divisionId: string,
  teamNames: string[]
): Promise<BulkCreateTeamsResult> {
  try {
    const isAdmin = await requireOrgAdmin(organizationId);
    if (!isAdmin) {
      return { error: 'Only an organization admin can import teams.' };
    }

    const cleaned = teamNames.map((n) => n.trim()).filter((n) => n.length > 0);

    if (cleaned.length === 0) {
      return { error: 'No valid team names found in the file.' };
    }

    const admin = createAdminClient();

    const { error } = await admin
      .from('teams')
      .insert(cleaned.map((name) => ({ division_id: divisionId, name })));

    if (error) {
      return { error: `Failed to import teams: ${error.message}` };
    }

    return { count: cleaned.length };
  } catch (err) {
    return {
      error: err instanceof Error ? `Unexpected server error: ${err.message}` : 'Unexpected server error.',
    };
  }
}
