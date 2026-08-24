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
          <p className="text-sm font-semibold">Watch this post</p>
          <p className="mt-1 text-sm text-(--muted)">{accessSummary(accessState)}</p>
        </div>
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
            idleCopy="Review the exact price and terms, then approve in your wallet. Access appears after the payment is confirmed."
            pendingLabel="Preparing unlock"
            readyCopy="Your confirmed access will appear here automatically."
          />
        ) : (
          <p className="text-sm leading-6 text-(--muted)">{accessState === "pass_required" ? "This post is included with its related Event Access Pass." : "You already have access to the full post."}</p>
        )}
      </div>
    </section>
  );
}

function accessSummary(accessState: string) {
  if (accessState === "locked" || accessState === "teaser") return "Unlock the full post with one wallet payment.";
  if (accessState === "pass_required") return "A related Event Access Pass is required.";
  if (accessState === "subscribed") return "Included with your membership.";
  return "Full access is ready.";
}
