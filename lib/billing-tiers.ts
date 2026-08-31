// lib/billing-tiers.ts
// Deliberately NOT a 'use server' file — Server Action files can only
// export async functions, so a plain constant like TIERS silently gets
// dropped if it lives in an actions file.

export const TIERS = {
  starter: { label: 'Starter', priceCents: 4900 },
  growth: { label: 'Growth', priceCents: 9900 },
  enterprise: { label: 'Enterprise', priceCents: 19900 },
} as const;

export type TierKey = keyof typeof TIERS;
