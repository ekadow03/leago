// app/admin/billing/billing-panel.tsx
'use client';

import { useState } from 'react';
import { startSubscriptionCheckout, cancelSubscription } from '@/lib/actions/billing';
import { TIERS, TierKey } from '@/lib/billing-tiers';

interface Subscription {
  id: string;
  tier: string;
  status: string;
  current_period_end: string | null;
}

export default function BillingPanel({
  organizationId,
  organizationName,
  subscription,
}: {
  organizationId: string;
  organizationName: string;
  subscription: Subscription | null;
}) {
  const [error, setError] = useState<string | null>(null);
  const [loadingTier, setLoadingTier] = useState<TierKey | null>(null);
  const [canceling, setCanceling] = useState(false);

  async function handleSubscribe(tier: TierKey) {
    setLoadingTier(tier);
    setError(null);
    try {
      const { checkoutUrl } = await startSubscriptionCheckout(organizationId, tier);
      window.location.href = checkoutUrl;
    } catch (err: any) {
      setError(err.message);
      setLoadingTier(null);
    }
  }

  async function handleCancel() {
    if (!confirm('Cancel your subscription? You\'ll keep access until the end of the current billing period.')) return;
    setCanceling(true);
    setError(null);
    try {
      await cancelSubscription(organizationId);
      alert('Subscription will cancel at the end of the current billing period.');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCanceling(false);
    }
  }

  const isActive = subscription?.status === 'active';

  return (
    <div style={{ maxWidth: 700, margin: '40px auto', fontFamily: 'system-ui', padding: '0 20px' }}>
      <h1>{organizationName} — Billing</h1>

      {error && <p style={{ color: 'red' }}>{error}</p>}

      {subscription && (
        <div style={{ padding: 16, background: '#f5f5f5', borderRadius: 8, marginBottom: 24 }}>
          <div>
            Current plan: <strong>{TIERS[subscription.tier as TierKey]?.label ?? subscription.tier}</strong>{' '}
            <span style={{ color: isActive ? 'green' : '#a00' }}>({subscription.status})</span>
          </div>
          {subscription.current_period_end && (
            <div style={{ fontSize: 13, color: '#666' }}>
              {isActive ? 'Renews' : 'Ends'} {new Date(subscription.current_period_end).toLocaleDateString()}
            </div>
          )}
          {isActive && (
            <button onClick={handleCancel} disabled={canceling} style={{ marginTop: 8, fontSize: 13, color: '#a00' }}>
              {canceling ? 'Canceling…' : 'Cancel subscription'}
            </button>
          )}
        </div>
      )}

      {!isActive && (
        <>
          <h2>Choose a plan</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
            {(Object.keys(TIERS) as TierKey[]).map((key) => {
              const tier = TIERS[key];
              return (
                <div key={key} style={{ border: '1px solid #ddd', borderRadius: 8, padding: 16, textAlign: 'center' }}>
                  <div style={{ fontWeight: 600 }}>{tier.label}</div>
                  <div style={{ fontSize: 24, margin: '8px 0' }}>${(tier.priceCents / 100).toFixed(0)}/mo</div>
                  <button onClick={() => handleSubscribe(key)} disabled={loadingTier !== null}>
                    {loadingTier === key ? 'Redirecting…' : 'Subscribe'}
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}