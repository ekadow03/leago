// lib/org-permissions.ts
// Client-safe permission constants/types shared between server logic
// (lib/org-context.ts) and Client Components. This file must NOT import
// anything that touches next/headers (e.g. lib/supabase/server) — a
// Client Component like app/admin/members/members-manager.tsx imports
// from here directly, and Turbopack bundles this whole module into the
// client bundle, so any server-only import here breaks the build with
// "You're importing a module that depends on next/headers... but you are
// using it in the Pages Router."

export type OrgRole = 'player' | 'parent' | 'coach' | 'volunteer' | 'admin';

// Mirrors the check constraint on organization_permissions.permission in
// 0022_delegated_permissions.sql — keep these two lists in sync. An org
// admin implicitly has every permission (see requireOrgPermission in
// lib/org-context.ts and that migration's has_org_permission() SQL
// function) and never needs a row in organization_permissions.
export type OrgPermission =
  | 'manage_members'
  | 'manage_divisions'
  | 'manage_registrations'
  | 'manage_compliance'
  | 'manage_evaluations'
  | 'manage_draft'
  | 'manage_schedule'
  | 'manage_volunteers'
  | 'manage_tournaments'
  | 'manage_communications';

export const ALL_ORG_PERMISSIONS: { key: OrgPermission; label: string }[] = [
  { key: 'manage_members', label: 'Manage members' },
  { key: 'manage_divisions', label: 'Set up seasons, divisions & teams' },
  { key: 'manage_registrations', label: 'Handle registrations & refunds' },
  { key: 'manage_compliance', label: 'Review compliance documents' },
  { key: 'manage_evaluations', label: 'Record player evaluations' },
  { key: 'manage_draft', label: 'Run the draft' },
  { key: 'manage_schedule', label: 'Build the schedule' },
  { key: 'manage_volunteers', label: 'Manage volunteer shifts' },
  { key: 'manage_tournaments', label: 'Run tournaments' },
  { key: 'manage_communications', label: 'Post announcements' },
];
