"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import {
  acceptPaymentIntentTerms,
  getPaymentIntent,
  getPaymentTransactionRequest,
  type PaymentIntent,
  type TransactionRequest
} from "@/api-mutations";
import { safeMutationMessage } from "@/api-errors";
import { createMutationIdempotencyKey } from "@/api-mutation-transport";
import { formatAssetAmount } from "@/format-asset-amount";

const PaymentWalletBridge = dynamic(
  () => import("./payment-wallet-bridge").then((module) => module.PaymentWalletBridge),
  { ssr: false }
);

interface PaymentHandoffPanelProps {
  createIntent: (idempotencyKey: string) => Promise<PaymentIntent | null>;
  ctaLabel: string;
  disabled?: boolean;
  idleCopy: string;
  pendingLabel?: string;
  readyCopy: string;
}

type CheckoutState =
  | "idle"
  | "creating"
  | "review"
  | "wallet"
  | "submitted"
  | "confirmed"
  | "error";

export function PaymentHandoffPanel({
  createIntent,
  ctaLabel,
  disabled = false,
  idleCopy,
  pendingLabel = "Preparing checkout",
  readyCopy
}: PaymentHandoffPanelProps) {
  const [state, setState] = useState<CheckoutState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [intent, setIntent] = useState<PaymentIntent | null>(null);
  const [transaction, setTransaction] = useState<TransactionRequest | null>(null);
  const [consent, setConsent] = useState(false);
  const [waiverConsent, setWaiverConsent] = useState(false);
  const checkoutAttempt = useRef<string | null>(null);
  const activeIntentId = intent?.id;

  useEffect(() => {
    if (!activeIntentId || (state !== "wallet" && state !== "submitted")) return;
    const paymentIntentId = activeIntentId;

    let cancelled = false;
    async function poll() {
      for (let attempt = 0; attempt < 15; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 2_000));
        if (cancelled) return;
        try {
          const current = await getPaymentIntent(paymentIntentId);
          if (cancelled) return;
          setIntent(current);
          if (current.state === "confirmed" || current.state === "settled") {
            checkoutAttempt.current = null;
            setState("confirmed");
            setMessage(readyCopy);
            return;
          }
          if (
            current.state === "failed" ||
            current.state === "expired" ||
            current.state === "cancelled"
          ) {
            throw new Error(`Payment ${current.state}`);
          }
        } catch (error) {
          if (!cancelled) {
            setState("error");
            setMessage(safeMutationMessage(error, "Payment"));
          }
          return;
        }
      }
      if (!cancelled) {
        setState("submitted");
        setMessage("Still verifying onchain. You can leave this page; access changes only after confirmation.");
      }
    }

    void poll();
    return () => {
      cancelled = true;
    };
  }, [activeIntentId, readyCopy, state]);

  async function prepareCheckout() {
    setState("creating");
    setMessage(null);
    setIntent(null);
    setTransaction(null);
    setConsent(false);
    setWaiverConsent(false);

    try {
      checkoutAttempt.current ??= createMutationIdempotencyKey();
      const paymentIntent = await createIntent(checkoutAttempt.current);
      if (!paymentIntent) {
        checkoutAttempt.current = null;
        setState("confirmed");
        setMessage(readyCopy);
        return;
      }
      setIntent(paymentIntent);
      setState("review");
    } catch (error) {
      fail(error);
    }
  }

  async function continueToWallet() {
    if (!intent || !consent || (intent.refundPolicy.withdrawalWaiverRequired && !waiverConsent)) {
      return;
    }
    setState("wallet");
    setMessage(null);
    try {
      await acceptPaymentIntentTerms(intent.id, {
        termsVersion: intent.refundPolicy.termsVersion,
        withdrawalWaiverVersion: intent.refundPolicy.withdrawalWaiverVersion,
        immediateAccessAcknowledged: waiverConsent
      });
      const request = await getPaymentTransactionRequest(intent.id);
      setTransaction(request);
      setState("wallet");
      setMessage("Scan the QR code or open the wallet request. This screen confirms only after backend verification.");
    } catch (error) {
      fail(error);
    }
  }

  function directWalletSubmitted() {
    setState("submitted");
    setMessage("Wallet submission received. WeVid is verifying settlement onchain.");
  }

  function fail(error: unknown) {
    setState("error");
    setMessage(safeMutationMessage(error, "Payment"));
  }

  function walletFailed(error: unknown) {
    setState("wallet");
    setMessage(`${safeMutationMessage(error, "Wallet approval")} Use the QR code or wallet link to continue.`);
  }

  return (
    <div className="grid gap-3" data-checkout-state={state}>
      <p className="text-sm leading-6 text-(--muted)">{message ?? idleCopy}</p>

      {state === "idle" || state === "error" ? (
        <button className="primary-button" disabled={disabled} onClick={() => void prepareCheckout()} type="button">
          {ctaLabel}
        </button>
      ) : state === "creating" ? (
        <button className="primary-button" disabled type="button">{pendingLabel}</button>
      ) : null}

      {intent ? (
        <div className="grid gap-3 rounded border border-(--line) bg-(--background) p-3 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <Fact label="Total" value={formatAssetAmount(intent.amountMinor, intent.currency)} />
            <Fact label="Product" value={productLabel(intent.productType)} />
            <Fact label="Creator side" value={formatAssetAmount(intent.creatorSideProceedsMinor, intent.currency)} />
            <Fact label="Platform fee" value={formatAssetAmount(intent.platformFeeAmountMinor, intent.currency)} />
          </div>
          <p className="text-xs leading-5 text-(--muted)">
            The wallet approval is not payment proof. WeVid grants access or issues a receipt only after backend onchain verification.
          </p>
          {state === "review" ? (
            <>
              <label className="flex items-start gap-2 text-sm text-(--muted)">
                <input checked={consent} className="mt-1 size-4 accent-(--accent)" onChange={(event) => setConsent(event.target.checked)} type="checkbox" />
                <span>
                  I accept the checkout terms.
                </span>
              </label>
              {intent.refundPolicy.withdrawalWaiverRequired ? (
                <label className="flex items-start gap-2 text-sm text-(--muted)">
                  <input checked={waiverConsent} className="mt-1 size-4 accent-(--accent)" onChange={(event) => setWaiverConsent(event.target.checked)} type="checkbox" />
                  <span>
                    I request immediate digital access after confirmed settlement and acknowledge that, where applicable, I lose my statutory withdrawal right once access begins.
                  </span>
                </label>
              ) : null}
              <button className="primary-button" disabled={!consent || (intent.refundPolicy.withdrawalWaiverRequired && !waiverConsent)} onClick={() => void continueToWallet()} type="button">
                Continue to wallet
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      {transaction && state === "wallet" ? (
        <div className="grid justify-items-center gap-3 rounded border border-(--line) p-3">
          <PaymentWalletBridge
            intentId={intent?.id ?? ""}
            onError={walletFailed}
            onSubmitted={directWalletSubmitted}
            request={transaction}
          />
          {transaction.qrDataUrl ? (
            // Commerce Kit creates this data URL from the same opaque backend capability.
            <img alt="Wallet checkout QR code" className="size-52 rounded bg-white p-2" src={transaction.qrDataUrl} />
          ) : null}
          <a className="secondary-button" href={transaction.transactionRequestUrl}>Open wallet</a>
        </div>
      ) : null}

      {state === "submitted" ? (
        <a className="secondary-button text-center" href="/app/activity">View payment activity</a>
      ) : null}
      {message && state === "error" ? (
        <div className="grid gap-2 rounded border border-[#7f1d1d] bg-[#450a0a] px-3 py-2 text-sm text-[#fecaca]">
          <p>{message}</p>
          <button className="secondary-button justify-self-start" onClick={() => void prepareCheckout()} type="button">Try again</button>
        </div>
      ) : null}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><p className="text-xs uppercase text-(--muted)">{label}</p><p className="mt-1 truncate font-medium">{value}</p></div>;
}

function productLabel(product: PaymentIntent["productType"]) {
  return product.replaceAll("_", " ");
}
