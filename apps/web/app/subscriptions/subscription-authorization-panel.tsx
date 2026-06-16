"use client";

import { useState, type FormEvent } from "react";
import type { SubscriptionPlan } from "@/api-client";
import {
  ApiMutationError,
  createSubscriptionIntent,
  submitSubscriptionAuthorization,
  type Subscription,
  type SubscriptionAuthorizationIntent
} from "@/api-mutations";

interface SubscriptionAuthorizationPanelProps {
  plan: SubscriptionPlan;
}

export function SubscriptionAuthorizationPanel({ plan }: SubscriptionAuthorizationPanelProps) {
  const [intent, setIntent] = useState<SubscriptionAuthorizationIntent | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [signature, setSignature] = useState("");
  const [authorityAddress, setAuthorityAddress] = useState("");
  const [delegationAddress, setDelegationAddress] = useState("");
  const [subscriberTokenAccount, setSubscriberTokenAccount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<"intent" | "submission" | null>(null);
  const disabled =
    plan.providerState !== "launch_approved" ||
    !plan.tokenMint ||
    plan.tokenMint === "SOL" ||
    plan.currency === "SOL";

  async function onCreateIntent() {
    setPending("intent");
    setError(null);

    try {
      const nextIntent = await createSubscriptionIntent({
        planId: plan.id,
        ...(plan.creator?.id ? { creatorUserId: plan.creator.id } : {})
      });
      setIntent(nextIntent);
      setSubscription(nextIntent.subscription);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(null);
    }
  }

  async function onSubmitAuthorization(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!intent) return;

    setPending("submission");
    setError(null);

    try {
      const nextSubscription = await submitSubscriptionAuthorization(intent.id, {
        authorityAddress,
        delegationAddress,
        signature,
        subscriberTokenAccount
      });
      setSubscription(nextSubscription);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="mt-4 grid gap-3 border-t border-(--line) pt-4">
      <button
        className="rounded bg-(--foreground) px-3 py-2 text-sm font-semibold text-(--background) disabled:cursor-not-allowed disabled:opacity-50"
        disabled={disabled || pending !== null}
        onClick={onCreateIntent}
        type="button"
      >
        {pending === "intent" ? "Creating authorization" : "Start auto-renew setup"}
      </button>

      <p className="text-sm leading-6 text-(--muted)">
        This creates a backend-owned subscription setup intent only for launch-approved token plans.
        Access changes only after backend verification and future collection evidence.
      </p>

      {disabled ? (
        <p className="text-sm font-medium text-(--muted)">
          Subscription setup is unavailable until the official token provider, mint, program, and
          on-chain verification are configured.
        </p>
      ) : null}

      {intent ? (
        <div className="grid gap-3 rounded border border-(--line) bg-(--background) p-3 text-sm">
          <Fact label="Authorization intent" value={intent.id} />
          <Fact label="Setup reference" value={intent.setupReference} />
          <Fact label="Provider readiness" value={intent.providerReadiness.delegatedSubscriptions} />
          <Fact label="Expires" value={intent.expiresAt ?? "pending provider setup"} />
          {intent.transactionRequestUrl ? (
            <a
              className="rounded border border-(--line) px-3 py-2 text-center font-semibold"
              href={intent.transactionRequestUrl}
              rel="noreferrer"
              target="_blank"
            >
              Open wallet setup request
            </a>
          ) : (
            <p className="text-(--muted)">
              Wallet setup request is not available until the delegated subscription provider is
              configured and staging-approved.
            </p>
          )}
        </div>
      ) : null}

      {intent ? (
        <form className="grid gap-2" onSubmit={onSubmitAuthorization}>
          <TextInput label="Setup signature" onChange={setSignature} value={signature} />
          <TextInput label="Authority address" onChange={setAuthorityAddress} value={authorityAddress} />
          <TextInput label="Delegation address" onChange={setDelegationAddress} value={delegationAddress} />
          <TextInput
            label="Subscriber token account"
            onChange={setSubscriberTokenAccount}
            value={subscriberTokenAccount}
          />
          <button
            className="rounded border border-(--line) px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
            disabled={pending !== null}
            type="submit"
          >
            {pending === "submission" ? "Submitting evidence" : "Submit authorization evidence"}
          </button>
        </form>
      ) : null}

      {subscription ? (
        <div className="rounded border border-(--line) bg-(--background) p-3 text-sm">
          <Fact label="Subscription state" value={subscription.state} />
          <Fact label="Renewal mode" value={subscription.renewalMode} />
        </div>
      ) : null}

      {error ? <p className="text-sm font-medium text-red-400">{error}</p> : null}
    </div>
  );
}

function TextInput({
  label,
  onChange,
  value
}: {
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="text-(--muted)">{label}</span>
      <input
        className="rounded border border-(--line) bg-(--background) px-3 py-2 text-(--foreground)"
        onChange={(event) => onChange(event.currentTarget.value)}
        value={value}
      />
    </label>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs uppercase text-(--muted)">{label}</p>
      <p className="mt-1 break-words font-medium">{value}</p>
    </div>
  );
}

function errorMessage(caught: unknown) {
  if (caught instanceof ApiMutationError) {
    return caught.message;
  }

  return "Subscription action failed.";
}
