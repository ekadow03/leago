'use server';

// lib/actions/league-hub.ts

import { createAdminClient } from '@/lib/supabase/admin';
import { requireOrgPermission } from '@/lib/org-context';

interface UpdateProfileInput {
  organizationId: string;
  description?: string;
  contactEmail?: string;
  contactPhone?: string;
}

export async function updateOrgProfile(input: UpdateProfileInput): Promise<void> {
  const authorized = await requireOrgPermission(input.organizationId, 'manage_communications');
  if (!authorized) {
    throw new Error('You do not have permission to update the league profile.');
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from('organizations')
    .update({
      description: input.description ?? null,
      contact_email: input.contactEmail ?? null,
      contact_phone: input.contactPhone ?? null,
    })
    .eq('id', input.organizationId);

  if (error) {
    throw new Error(`Failed to update profile: ${error.message}`);
  }
}

export async function createAnnouncement(
  organizationId: string,
  title: string,
  body: string
): Promise<{ id: string }> {
  const authorized = await requireOrgPermission(organizationId, 'manage_communications');
  if (!authorized) {
    throw new Error('You do not have permission to post announcements.');
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('announcements')
    .insert({ organization_id: organizationId, title, body, status: 'draft' })
    .select('id')
    .single();

  if (error || !data) {
    throw new Error(`Failed to create announcement: ${error?.message}`);
  }

  return { id: data.id };
}

export async function setAnnouncementStatus(
  organizationId: string,
  announcementId: string,
  status: 'draft' | 'published'
): Promise<void> {
  const authorized = await requireOrgPermission(organizationId, 'manage_communications');
  if (!authorized) {
    throw new Error('You do not have permission to change announcement status.');
  }

  const admin = createAdminClient();
  const { error } = await admin.from('announcements').update({ status }).eq('id', announcementId);

  if (error) {
    throw new Error(`Failed to update status: ${error.message}`);
  }
}

export async function deleteAnnouncement(organizationId: string, announcementId: string): Promise<void> {
  const authorized = await requireOrgPermission(organizationId, 'manage_communications');
  if (!authorized) {
    throw new Error('You do not have permission to delete announcements.');
  }

  const admin = createAdminClient();
  const { error } = await admin.from('announcements').delete().eq('id', announcementId);

  if (error) {
    throw new Error(`Failed to delete: ${error.message}`);
  }
}
