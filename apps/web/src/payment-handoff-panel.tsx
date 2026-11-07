"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  acceptPaymentIntentTerms,
  getCurrentSession,
  getPaymentIntent,
  getPaymentTransactionRequest,
  type PaymentIntent,
  type TransactionRequest
} from "@/api-mutations";
import { safeMutationMessage } from "@/api-errors";
import { createMutationIdempotencyKey } from "@/api-mutation-transport";
import { formatAtomicAssetAmount } from "@/format-asset-amount";
import {
  paymentProjectionCheckoutState,
  refreshPaymentProjection
} from "@/payment-confirmation-projection";
import { runPaymentOperationWithDeadline } from "@/payment-operation-deadline";
import {
  paymentSubmissionRecoveryPrefix,
  readPendingPaymentSubmission,
  removePendingPaymentSubmission,
  type PaymentSubmissionBrowserScope,
  type PaymentSubmissionQuoteSnapshot,
  type PendingPaymentSubmission
} from "@/payment-submission-recovery";

const PaymentWalletRuntime = dynamic(
  () => import("./payment-wallet-runtime").then((module) => module.PaymentWalletRuntime),
  { ssr: false }
);

const paymentRecoveryRetryMs = 5_000;

interface PaymentHandoffPanelProps {
  createIntent: (idempotencyKey: string) => Promise<PaymentIntent | null>;
  ctaLabel: string;
  disabled?: boolean;
  idleCopy: string;
  pendingLabel?: string;
  readyCopy: string;
  recoveryScope: string;
  onConfirmed?: () => void | Promise<void>;
}

type CheckoutState =
  | "idle"
  | "creating"
  | "review"
  | "wallet"
  | "submitted"
  | "awaiting_projection"
  | "confirmed"
  | "error";

export function PaymentHandoffPanel({
  createIntent,
  ctaLabel,
  disabled = false,
  idleCopy,
  onConfirmed,
  pendingLabel = "Preparing checkout",
  readyCopy,
  recoveryScope
}: PaymentHandoffPanelProps) {
  const [state, setState] = useState<CheckoutState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [intent, setIntent] = useState<PaymentIntent | null>(null);
  const [transaction, setTransaction] = useState<TransactionRequest | null>(null);
  const [consent, setConsent] = useState(false);
  const [waiverConsent, setWaiverConsent] = useState(false);
  const [pendingSubmission, setPendingSubmission] = useState<PendingPaymentSubmission | null>(null);
  const checkoutAttempt = useRef<string | null>(null);
  const projectionRefresh = useRef(onConfirmed);
  const activeIntentId = intent?.id ?? pendingSubmission?.intentId;

  useEffect(() => {
    projectionRefresh.current = onConfirmed;
  }, [onConfirmed]);

  const restorePendingCheckout = useCallback((parentSignal?: AbortSignal): Promise<boolean> => {
    return runPaymentOperationWithDeadline(async (signal) => {
      const session = await getCurrentSession(signal);
      if (!session.authenticated || !session.user) return false;

      const browserScope: PaymentSubmissionBrowserScope = {
        actorUserId: session.user.id,
        clientSessionScope: session.clientSessionScope,
        recoveryScope
      };
      const record = readPendingPaymentSubmission(window.localStorage, browserScope);
      if (!record) return false;

      setPendingSubmission(record);
      setState("submitted");
      setMessage("A signed transaction is already pending. Reusing it without requesting another wallet payment.");

      try {
        const current = await getPaymentIntent(record.intentId, signal);
        setIntent(current);
        const confirmedState = paymentProjectionCheckoutState(
          current.state,
          Boolean(projectionRefresh.current)
        );
        if (confirmedState) {
          removeRecoveryRecord(record);
          setPendingSubmission(null);
          setState(confirmedState);
          setMessage(
            confirmedState === "awaiting_projection"
              ? "Payment confirmed by the backend. Waiting for the canonical access record."
              : readyCopy
          );
        } else if (["failed", "expired", "cancelled"].includes(current.state)) {
          removeRecoveryRecord(record);
          setPendingSubmission(null);
          checkoutAttempt.current = null;
          setState("error");
          setMessage(`Payment ${current.state}`);
        }
      } catch (error) {
        if (signal.aborted) throw error;
        // Keep the durable browser record and recovery-only runtime active. A temporary API failure
        // must never reveal a second transaction-building path.
      }

      return true;
    }, { signal: parentSignal });
  }, [readyCopy, recoveryScope]);

  useEffect(() => {
    let cancelled = false;
    let restoreRunning = false;
    let rerunRequested = false;
    let retryTimer: number | undefined;
    const controller = new AbortController();

    const scheduleRetry = () => {
      if (cancelled || retryTimer !== undefined) return;
      retryTimer = window.setTimeout(() => {
        retryTimer = undefined;
        startRestore();
      }, paymentRecoveryRetryMs);
    };

    const startRestore = () => {
      if (cancelled) return;
      if (restoreRunning) {
        rerunRequested = true;
        return;
      }
      if (retryTimer !== undefined) {
        window.clearTimeout(retryTimer);
        retryTimer = undefined;
      }
      restoreRunning = true;
      void restorePendingCheckout(controller.signal)
        .catch(() => {
          scheduleRetry();
        })
        .finally(() => {
          restoreRunning = false;
          if (rerunRequested && !cancelled) {
            rerunRequested = false;
            startRestore();
          }
        });
    };

    startRestore();

    const onStorage = (event: StorageEvent) => {
      if (
        !cancelled &&
        event.storageArea === window.localStorage &&
        event.key?.startsWith(paymentSubmissionRecoveryPrefix)
      ) {
        startRestore();
      }
    };
    window.addEventListener("storage", onStorage);
    return () => {
      cancelled = true;
      controller.abort(new Error("Payment recovery restoration unmounted"));
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      window.removeEventListener("storage", onStorage);
    };
  }, [restorePendingCheckout]);

  useEffect(() => {
    if (!activeIntentId || (state !== "wallet" && state !== "submitted")) return;
    const paymentIntentId = activeIntentId;

    let cancelled = false;
    const controller = new AbortController();
    async function poll() {
      for (let attempt = 0; attempt < 15; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 2_000));
        if (cancelled) return;
        try {
          const current = await runPaymentOperationWithDeadline(
            (signal) => getPaymentIntent(paymentIntentId, signal),
            { signal: controller.signal }
          );
          if (cancelled) return;
          setIntent(current);
          const confirmedState = paymentProjectionCheckoutState(
            current.state,
            Boolean(projectionRefresh.current)
          );
          if (confirmedState) {
            if (pendingSubmission) removeRecoveryRecord(pendingSubmission);
            setPendingSubmission(null);
            checkoutAttempt.current = null;
            setState(confirmedState);
            setMessage(
              confirmedState === "awaiting_projection"
                ? "Payment confirmed by the backend. Waiting for the canonical access record."
                : readyCopy
            );
            return;
          }
          if (
            current.state === "failed" ||
            current.state === "expired" ||
            current.state === "cancelled"
          ) {
            if (pendingSubmission) removeRecoveryRecord(pendingSubmission);
            setPendingSubmission(null);
            checkoutAttempt.current = null;
            setState("error");
            setMessage(`Payment ${current.state}`);
            return;
          }
        } catch (error) {
          if (cancelled || controller.signal.aborted) return;
          if (pendingSubmission) {
            setState("submitted");
            setMessage(
              "The signed transaction is retained while onchain verification is temporarily unavailable."
            );
            continue;
          }
          setState("error");
          setMessage(safeMutationMessage(error, "Payment"));
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
      controller.abort(new Error("Payment finality polling changed"));
    };
  }, [activeIntentId, pendingSubmission, readyCopy, state]);

  useEffect(() => {
    if (state !== "awaiting_projection") return;

    const refresh = projectionRefresh.current;
    if (!refresh) {
      setState("confirmed");
      setMessage(readyCopy);
      return;
    }

    const controller = new AbortController();
    void refreshPaymentProjection(refresh, { signal: controller.signal }).then((result) => {
      if (result === "exhausted" && !controller.signal.aborted) {
        setMessage(
          "The backend record is complete, but access is still updating. Refresh access or check payment activity."
        );
      }
    });

    return () => controller.abort();
  }, [readyCopy, state]);

  async function prepareCheckout() {
    setState("creating");
    setMessage(null);

    try {
      if (await restorePendingCheckout()) return;
      setIntent(null);
      setTransaction(null);
      setConsent(false);
      setWaiverConsent(false);
      checkoutAttempt.current ??= createMutationIdempotencyKey();
      const paymentIntent = await createIntent(checkoutAttempt.current);
      if (!paymentIntent) {
        checkoutAttempt.current = null;
        if (projectionRefresh.current) {
          setState("awaiting_projection");
          setMessage("The backend accepted the access change. Waiting for the canonical access record.");
        } else {
          setState("confirmed");
          setMessage(readyCopy);
        }
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
      if (await restorePendingCheckout()) return;
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

  const directWalletSubmitted = useCallback((record: PendingPaymentSubmission) => {
    setPendingSubmission(record);
    setIntent((current) => current?.id === record.intentId ? current : null);
    setState("submitted");
    setMessage("Signed transaction retained. WeVid is broadcasting and verifying this exact payment onchain.");
  }, []);

  function fail(error: unknown) {
    setState("error");
    setMessage(safeMutationMessage(error, "Payment"));
  }

  const walletFailed = useCallback((error: unknown) => {
    setState("wallet");
    setMessage(`${safeMutationMessage(error, "Wallet approval")} Use the QR code or wallet link to continue.`);
  }, []);

  const recoveryFailed = useCallback(() => {
    setPendingSubmission(null);
    setIntent(null);
    setTransaction(null);
    checkoutAttempt.current = null;
    setState("error");
    setMessage("The retained wallet transaction is invalid. Start a fresh checkout to continue.");
  }, []);

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
            <Fact label="Total" value={formatAtomicAssetAmount(intent.amountMinor, intent.currency)} />
            <Fact label="Product" value={productLabel(intent.productType)} />
            <Fact label="Creator side" value={formatAtomicAssetAmount(intent.creatorSideProceedsMinor, intent.currency)} />
            <Fact label="Platform fee" value={formatAtomicAssetAmount(intent.platformFeeAmountMinor, intent.currency)} />
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
          <PaymentWalletRuntime
            intentId={intent?.id ?? ""}
            onError={walletFailed}
            onSubmitted={directWalletSubmitted}
            quote={intent ? paymentSubmissionQuote(intent) : null}
            recoveryScope={recoveryScope}
            request={transaction}
          />
          {transaction.qrDataUrl ? (
            // Commerce Kit creates this data URL from the same opaque backend capability.
            <img alt="Wallet checkout QR code" className="size-52 rounded bg-white p-2" src={transaction.qrDataUrl} />
          ) : null}
          <a className="secondary-button" href={transaction.transactionRequestUrl}>Open wallet</a>
        </div>
      ) : null}

      {pendingSubmission && state === "submitted" ? (
        <PaymentWalletRuntime
          intentId={pendingSubmission.intentId}
          onError={recoveryFailed}
          onSubmitted={directWalletSubmitted}
          quote={null}
          recoveryScope={recoveryScope}
          request={null}
        />
      ) : null}

      {state === "submitted" || state === "awaiting_projection" ? (
        <div className="flex flex-wrap gap-2">
          <a className="secondary-button text-center" href="/app/activity">View payment activity</a>
          {state === "awaiting_projection" && onConfirmed ? (
            <button className="secondary-button" onClick={() => void onConfirmed()} type="button">
              Refresh access
            </button>
          ) : null}
        </div>
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

function removeRecoveryRecord(record: PendingPaymentSubmission) {
  removePendingPaymentSubmission(window.localStorage, record, {
    intentId: record.intentId,
    signature: record.signature
  });
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><p className="text-xs uppercase text-(--muted)">{label}</p><p className="mt-1 truncate font-medium">{value}</p></div>;
}

function productLabel(product: PaymentIntent["productType"]) {
  return product.replaceAll("_", " ");
}

function paymentSubmissionQuote(intent: PaymentIntent): PaymentSubmissionQuoteSnapshot {
  return {
    productType: intent.productType,
    amountMinor: intent.amountMinor,
    currency: intent.currency,
    settlementKind: intent.settlementKind,
    creatorSideProceedsMinor: intent.creatorSideProceedsMinor,
    creatorAmountMinor: intent.creatorAmountMinor,
    enterpriseManagementAmountMinor: intent.enterpriseManagementAmountMinor,
    platformFeeGrossMinor: intent.platformFeeGrossMinor,
    platformFeeAmountMinor: intent.platformFeeAmountMinor,
    referralAmountMinor: intent.referralAmountMinor,
    minimumAmountMinor: intent.quote.minimumAmountMinor,
    platformFeeBps: intent.quote.platformFeeBps,
    referralShareOfPlatformFeeBps: intent.quote.referralShareOfPlatformFeeBps,
    quotedAt: intent.quote.quotedAt,
    expiresAt: intent.quote.expiresAt,
    policySource: intent.quote.policySource,
    policyRevision: intent.quote.policyRevision,
    termsVersion: intent.refundPolicy.termsVersion,
    withdrawalWaiverVersion: intent.refundPolicy.withdrawalWaiverVersion
  };
}
