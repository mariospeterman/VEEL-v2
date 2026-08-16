"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Transaction } from "@solana/web3.js";
import { useState } from "react";
import type { SubscriptionPlan } from "@/api-client";
import {
  ApiMutationError,
  createSubscriptionIntent,
  getSubscriptionAuthorizationTransaction,
  submitSubscriptionAuthorization,
  type Subscription
} from "@/api-mutations";

export function SubscriptionAuthorizationPanel({ plan }: { plan: SubscriptionPlan }) {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const { setVisible } = useWalletModal();
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const available =
    plan.providerState === "launch_approved" &&
    Boolean(plan.tokenMint && plan.tokenMint !== "SOL" && plan.currency !== "SOL");

  async function authorize() {
    if (!publicKey) {
      setVisible(true);
      return;
    }
    setPending(true);
    setError(null);
    try {
      const intent = await createSubscriptionIntent({
        planId: plan.id,
        ...(plan.creator?.id ? { creatorUserId: plan.creator.id } : {})
      });
      if (
        intent.subscription.subscriberWallet &&
        intent.subscription.subscriberWallet !== publicKey.toBase58()
      ) {
        throw new ApiMutationError("Use the wallet linked as your primary WeVid wallet.", 409);
      }
      const unsigned = await getSubscriptionAuthorizationTransaction(intent.id);
      const transaction = Transaction.from(decodeBase64(unsigned.transaction));
      const signature = await sendTransaction(transaction, connection);
      setSubscription(await submitSubscriptionAuthorization(intent.id, { signature }));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  }

  const label = !publicKey
    ? "Connect wallet"
    : plan.scope === "creator" && plan.creator
      ? `Join @${plan.creator.handle}`
      : "Choose plan";

  return (
    <div className="mt-4 grid gap-3 border-t border-(--line) pt-4">
      <button
        className="rounded bg-(--foreground) px-3 py-2 text-sm font-semibold text-(--background) disabled:cursor-not-allowed disabled:opacity-50"
        disabled={!available || pending}
        onClick={() => void authorize()}
        type="button"
      >
        {pending ? "Waiting for wallet" : label}
      </button>
      <p className="text-sm leading-6 text-(--muted)">
        Approve once in your wallet. WeVid activates access only after the first verified payment;
        future payments stay limited to this price and billing period.
      </p>
      {!available ? (
        <p className="text-sm font-medium text-(--muted)">
          This plan is not available yet.
        </p>
      ) : null}
      {subscription ? (
        <p aria-live="polite" className="text-sm font-medium">
          {subscription.state === "renewal_pending"
            ? "Authorization confirmed. Verifying the first payment now."
            : `Membership state: ${subscription.state.replaceAll("_", " ")}`}
        </p>
      ) : null}
      {error ? <p className="text-sm font-medium text-red-400">{error}</p> : null}
    </div>
  );
}

function decodeBase64(value: string) {
  const binary = window.atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function errorMessage(caught: unknown) {
  return caught instanceof ApiMutationError ? caught.message : "Wallet authorization failed.";
}
