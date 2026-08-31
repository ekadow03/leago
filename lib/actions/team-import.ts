'use server';

// lib/actions/team-import.ts
// Bulk team creation from a CSV upload — one row per team name. Keeps
// coach assignment out of scope here (that requires a real person/account,
// which a CSV import can't create safely) — teams come in with no coach
// assigned, same as if created one at a time via the existing UI.

import { createAdminClient } from '@/lib/supabase/admin';
import { requireOrgAdmin } from '@/lib/org-context';

export async function bulkCreateTeams(
  organizationId: string,
  divisionId: string,
  teamNames: string[]
): Promise<{ count: number }> {
  const isAdmin = await requireOrgAdmin(organizationId);
  if (!isAdmin) {
    throw new Error('Only an organization admin can import teams.');
  }

  const cleaned = teamNames.map((n) => n.trim()).filter((n) => n.length > 0);

  if (cleaned.length === 0) {
    throw new Error('No valid team names found in the file.');
  }

  const admin = createAdminClient();

  const { error } = await admin
    .from('teams')
    .insert(cleaned.map((name) => ({ division_id: divisionId, name })));

  if (error) {
    throw new Error(`Failed to import teams: ${error.message}`);
  }

  return { count: cleaned.length };
}
