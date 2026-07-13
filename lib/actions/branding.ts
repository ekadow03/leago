'use server';

// lib/actions/branding.ts
// White-label branding for tournament operators — lets an org set a
// custom subdomain, logo, and accent color so their public tournament
// pages look like their own platform rather than showing "leago" branding.

import { createAdminClient } from '@/lib/supabase/admin';
import { requireOrgAdmin } from '@/lib/org-context';

interface UpdateBrandingInput {
  organizationId: string;
  subdomain?: string;
  logoUrl?: string;
  primaryColor?: string;
}

const SUBDOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export async function updateBranding(input: UpdateBrandingInput): Promise<void> {
  const isAdmin = await requireOrgAdmin(input.organizationId);
  if (!isAdmin) {
    throw new Error('Only an organization admin can update branding.');
  }

  const admin = createAdminClient();

  const updates: Record<string, any> = {};

  if (input.subdomain !== undefined) {
    const normalized = input.subdomain.toLowerCase().trim();
    if (normalized && !SUBDOMAIN_PATTERN.test(normalized)) {
      throw new Error('Subdomain can only contain lowercase letters, numbers, and hyphens.');
    }
    updates.subdomain = normalized || null;
  }

  if (input.logoUrl !== undefined || input.primaryColor !== undefined) {
    const { data: current } = await admin
      .from('organizations')
      .select('branding_theme')
      .eq('id', input.organizationId)
      .single();

    const theme = { ...(current?.branding_theme ?? {}) };
    if (input.logoUrl !== undefined) theme.logoUrl = input.logoUrl || null;
    if (input.primaryColor !== undefined) theme.primaryColor = input.primaryColor || null;
    updates.branding_theme = theme;
  }

  const { error } = await admin.from('organizations').update(updates).eq('id', input.organizationId);

  if (error) {
    if (error.code === '23505') {
      throw new Error('That subdomain is already taken by another organization.');
    }
    throw new Error(`Failed to update branding: ${error.message}`);
  }
}