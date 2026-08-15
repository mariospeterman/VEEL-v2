"use client";

import { ApiMutationError, createContentUnlockIntent } from "@/api-mutations";
import { PaymentHandoffPanel } from "@/payment-handoff-panel";

interface ContentUnlockPanelProps {
  contentId: string;
  accessState: string;
}

export function ContentUnlockPanel({ contentId, accessState }: ContentUnlockPanelProps) {
  const needsUnlock = accessState === "locked" || accessState === "teaser";

  return (
    <section className="rounded border border-(--line) bg-(--panel) p-4" id="unlock">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">Access</p>
          <p className="mt-1 text-sm text-(--muted)">Backend entitlement required</p>
        </div>
        <span className="rounded bg-(--accent-soft) px-2 py-1 text-xs font-medium uppercase text-(--accent-strong)">{accessState}</span>
      </div>
      <div className="mt-5 border-t border-(--line) pt-4">
        {needsUnlock ? (
          <PaymentHandoffPanel
            createIntent={async (idempotencyKey) => {
              const result = await createContentUnlockIntent(contentId, idempotencyKey);
              if (result.state === "already_unlocked") return null;
              if (!result.paymentIntent) throw new ApiMutationError("Unlock checkout is unavailable.");
              return result.paymentIntent;
            }}
            ctaLabel="Unlock content"
            idleCopy="Review the exact price, accept the checkout terms, then approve in your wallet. Access changes only after backend settlement verification."
            pendingLabel="Preparing unlock"
            readyCopy="Content access is confirmed by the backend entitlement projection."
          />
        ) : (
          <p className="text-sm leading-6 text-(--muted)">Full access is already reflected by the backend projection.</p>
        )}
      </div>
    </section>
  );
}
