"use client";

import { useState } from "react";
import type { Subscription } from "@/api-client";
import { ApiMutationError, cancelSubscription } from "@/api-mutations";

export function SubscriptionCancelPanel({ subscription }: { subscription: Subscription }) {
  const [current, setCurrent] = useState(subscription);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const cancellable = !["cancelled", "expired", "revoked"].includes(current.state);

  async function onCancel() {
    setPending(true);
    setError(null);

    try {
      setCurrent(await cancelSubscription(current.id));
    } catch (caught) {
      setError(caught instanceof ApiMutationError ? caught.message : "Cancellation failed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mt-4 grid gap-3 border-t border-(--line) pt-4">
      <button
        className="rounded border border-(--line) px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
        disabled={!cancellable || pending}
        onClick={onCancel}
        type="button"
      >
        {pending ? "Cancelling" : "Cancel renewal"}
      </button>
      <p className="text-sm leading-6 text-(--muted)">
        Cancellation stops future WeVid renewals. You can also remove the payment permission from your wallet.
      </p>
      {current.id !== subscription.id || current.state !== subscription.state ? (
        <p className="text-sm font-medium">{["cancelled", "expired", "revoked"].includes(current.state) ? "Renewal cancelled" : "Cancellation saved"}</p>
      ) : null}
      {error ? <p className="text-sm font-medium text-red-400">{error}</p> : null}
    </div>
  );
}
