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
    <div>
      {error && <p style={{ color: '#B23A2E', marginBottom: 12 }}>{error}</p>}

      {subscription && (
        <div className="current-plan-card" style={{ marginBottom: 24 }}>
          <div>
            Current plan: <strong>{TIERS[subscription.tier as TierKey]?.label ?? subscription.tier}</strong>{' '}
            <span className={`status-badge ${isActive ? 'active' : 'canceled'}`}>{subscription.status}</span>
          </div>
          {subscription.current_period_end && (
            <div style={{ fontSize: 13, color: 'var(--gray)', marginTop: 6 }}>
              {isActive ? 'Renews' : 'Ends'} {new Date(subscription.current_period_end).toLocaleDateString()}
            </div>
          )}
          {isActive && (
            <button onClick={handleCancel} disabled={canceling} className="btn-small" style={{ marginTop: 12 }}>
              {canceling ? 'Canceling…' : 'Cancel subscription'}
            </button>
          )}
        </div>
      )}

      {!isActive && (
        <>
          <h3 style={{ fontWeight: 800 }}>Choose a plan</h3>
          <div className="plan-grid">
            {(Object.keys(TIERS) as TierKey[]).map((key) => {
              const tier = TIERS[key];
              return (
                <div key={key} className="plan-card">
                  <div className="plan-name">{tier.label}</div>
                  <div className="plan-price">${(tier.priceCents / 100).toFixed(0)}/mo</div>
                  <button onClick={() => handleSubscribe(key)} disabled={loadingTier !== null} className="btn-primary" style={{ width: '100%' }}>
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
