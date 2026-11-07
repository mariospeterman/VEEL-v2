"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Transaction, type Connection } from "@solana/web3.js";
import bs58 from "bs58";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import {
  createSolanaPayCheckoutTransaction,
  getCurrentSession,
  submitPaymentSignature,
  type TransactionRequest
} from "@/api-mutations";
import { createMutationIdempotencyKey } from "@/api-mutation-transport";
import { coalescePaymentBroadcast } from "@/payment-broadcast-coalescing";
import {
  deliverPendingPaymentSubmission,
  paymentSubmissionDeliveryTimeoutMs
} from "@/payment-submission-delivery";
import {
  paymentSigningAttemptIdentity,
  runFencedPaymentSigningApproval,
  runWithExclusivePaymentSigningOwnership
} from "@/payment-signing-attempt";
import {
  applyPaymentSubmissionDeliveryResult,
  paymentSubmissionRecoveryKey,
  readPendingPaymentSubmission,
  storePendingPaymentSubmission,
  type PaymentSubmissionBrowserScope,
  type PaymentSubmissionQuoteSnapshot,
  type PendingPaymentSubmission
} from "@/payment-submission-recovery";

export function PaymentWalletBridge({
  intentId,
  onError,
  onSubmitted,
  quote,
  recoveryScope,
  request
}: {
  intentId: string;
  onError: (error: unknown) => void;
  onSubmitted: (record: PendingPaymentSubmission) => void;
  quote: PaymentSubmissionQuoteSnapshot | null;
  recoveryScope: string;
  request: TransactionRequest | null;
}) {
  const { connection } = useConnection();

  if (!request) {
    return (
      <PaymentRecoveryAttempt
        connection={connection}
        intentId={intentId}
        onError={onError}
        onSubmitted={onSubmitted}
        recoveryScope={recoveryScope}
      />
    );
  }

  return (
    <PaymentSigningAttempt
      intentId={intentId}
      onError={onError}
      onSubmitted={onSubmitted}
      quote={quote}
      recoveryScope={recoveryScope}
      request={request}
    />
  );
}

function PaymentRecoveryAttempt({
  connection,
  intentId,
  onError,
  onSubmitted,
  recoveryScope
}: {
  connection: Connection;
  intentId: string;
  onError: (error: unknown) => void;
  onSubmitted: (record: PendingPaymentSubmission) => void;
  recoveryScope: string;
}) {
  const notifySubmitted = useEffectEvent(onSubmitted);
  const notifyError = useEffectEvent(onError);
  const [retryVersion, setRetryVersion] = useState(0);

  useEffect(() => {
    if (!intentId || !recoveryScope) return;

    let disposed = false;
    let recoveryRetryTimer: number | undefined;
    const controller = new AbortController();
    const attemptDeadline = window.setTimeout(() => {
      controller.abort(new Error("Payment recovery attempt deadline exceeded"));
    }, paymentSubmissionDeliveryTimeoutMs);

    void (async () => {
      try {
        const session = await getCurrentSession(controller.signal);
        if (!session.authenticated || !session.user) {
          throw new Error("An authenticated WeVid session is required for payment recovery");
        }

        const browserScope: PaymentSubmissionBrowserScope = {
          actorUserId: session.user.id,
          clientSessionScope: session.clientSessionScope,
          recoveryScope
        };
        const existing = readPendingPaymentSubmission(window.localStorage, browserScope);
        if (!existing) {
          scheduleRecoveryRetry();
          return;
        }

        notifySubmitted(existing);
        const result = await deliverExistingSubmission(existing, connection, controller.signal);
        const disposition = applyPaymentSubmissionDeliveryResult(
          window.localStorage,
          existing,
          result
        );
        if (disposition === "retry") {
          scheduleRecoveryRetry();
        } else if (disposition === "invalid" && !disposed) {
          notifyError(new Error("Retained payment transaction was rejected"));
        }
      } catch {
        if (!disposed) scheduleRecoveryRetry();
      } finally {
        window.clearTimeout(attemptDeadline);
      }
    })();

    function scheduleRecoveryRetry() {
      if (disposed || recoveryRetryTimer !== undefined) return;
      recoveryRetryTimer = window.setTimeout(() => {
        if (!disposed) setRetryVersion((current) => current + 1);
      }, 5_000);
    }

    return () => {
      disposed = true;
      controller.abort(new Error("Payment recovery attempt unmounted"));
      window.clearTimeout(attemptDeadline);
      if (recoveryRetryTimer !== undefined) window.clearTimeout(recoveryRetryTimer);
    };
  }, [connection, intentId, recoveryScope, retryVersion]);

  return (
    <p className="text-sm text-(--muted)">
      Reusing the retained signed transaction while WeVid reconciles onchain settlement.
    </p>
  );
}

function PaymentSigningAttempt({
  intentId,
  onError,
  onSubmitted,
  quote,
  recoveryScope,
  request
}: {
  intentId: string;
  onError: (error: unknown) => void;
  onSubmitted: (record: PendingPaymentSubmission) => void;
  quote: PaymentSubmissionQuoteSnapshot | null;
  recoveryScope: string;
  request: TransactionRequest;
}) {
  const { publicKey, signTransaction, wallet } = useWallet();
  const { setVisible } = useWalletModal();
  const notifyError = useEffectEvent(onError);
  const notifySubmitted = useEffectEvent(onSubmitted);
  const activeAttempt = useRef<symbol | null>(null);
  const [failed, setFailed] = useState(false);
  const [retryVersion, setRetryVersion] = useState(0);
  const walletAddress = publicKey?.toBase58() ?? null;
  const checkoutUrl = request.checkoutUrl;
  const requestExpiresAt = request.expiresAt;
  const attemptIdentity = paymentSigningAttemptIdentity({
    checkoutUrl,
    expiresAt: requestExpiresAt,
    intentId,
    qrDataUrl: request.qrDataUrl,
    recoveryScope,
    retryVersion,
    signingCapability: signTransaction,
    transactionRequestUrl: request.transactionRequestUrl,
    walletAdapterName: wallet?.adapter.name ?? null,
    walletAddress
  });

  useEffect(() => {
    if (!intentId || !recoveryScope) return;
    if (!checkoutUrl) return;

    const attemptToken = Symbol(attemptIdentity);
    const controller = new AbortController();
    activeAttempt.current = attemptToken;
    setFailed(false);
    const ownsAttempt = () => activeAttempt.current === attemptToken;
    const canContinueBeforeApproval = () => ownsAttempt() && !controller.signal.aborted;

    void (async () => {
      try {
        const session = await getCurrentSession(controller.signal);
        if (!canContinueBeforeApproval()) return;
        if (!session.authenticated || !session.user) {
          throw new Error("An authenticated WeVid session is required for payment recovery");
        }

        const browserScope: PaymentSubmissionBrowserScope = {
          actorUserId: session.user.id,
          clientSessionScope: session.clientSessionScope,
          recoveryScope
        };
        const existing = readPendingPaymentSubmission(window.localStorage, browserScope);

        if (existing) {
          if (ownsAttempt()) notifySubmitted(existing);
          return;
        }

        if (!walletAddress) return;
        if (!quote || !signTransaction) {
          throw new Error("This wallet cannot safely sign a recoverable transaction");
        }

        await runWithExclusivePaymentSigningOwnership(
          paymentSubmissionRecoveryKey(browserScope),
          async () => {
            if (!canContinueBeforeApproval()) return;
            const retained = readPendingPaymentSubmission(window.localStorage, browserScope);
            if (retained) {
              if (ownsAttempt()) notifySubmitted(retained);
              return;
            }

            await runFencedPaymentSigningApproval<Transaction, Transaction, PendingPaymentSubmission>({
              approve: (transaction: Transaction) => signTransaction(transaction),
              isCurrent: ownsAttempt,
              onRetained: (record) => notifySubmitted(record),
              prepare: async (signal) => {
                const unsigned = await createSolanaPayCheckoutTransaction(
                  checkoutUrl,
                  walletAddress,
                  signal
                );
                const transaction = Transaction.from(decodeBase64(unsigned.transaction));
                if (transaction.feePayer?.toBase58() !== walletAddress) {
                  throw new Error("Wallet request fee payer does not match the connected wallet");
                }
                return transaction;
              },
              retain: (signedTransaction) => {
                // Wallet approval cannot be cancelled. Even if this React attempt became stale while
                // the prompt was open, retain exactly what the wallet approved before fencing UI.
                const signatureBytes = signedTransaction.signature;
                if (!signatureBytes) {
                  throw new Error("Wallet did not return a transaction signature");
                }
                const candidate: PendingPaymentSubmission = {
                  schemaVersion: 1,
                  ...browserScope,
                  intentId,
                  walletAddress,
                  quote,
                  signature: bs58.encode(signatureBytes),
                  signedTransactionBase64: encodeBase64(signedTransaction.serialize()),
                  idempotencyKey: createMutationIdempotencyKey(),
                  intentExpiresAt: requestExpiresAt,
                  createdAt: new Date().toISOString()
                };
                return storePendingPaymentSubmission(window.localStorage, candidate).record;
              },
              signal: controller.signal
            });
          }
        );
      } catch (error) {
        if (ownsAttempt()) {
          setFailed(true);
          notifyError(error);
        }
      }
    })();

    return () => {
      if (ownsAttempt()) activeAttempt.current = null;
      controller.abort(new Error("Payment signing attempt changed"));
    };
  }, [
    attemptIdentity,
    checkoutUrl,
    intentId,
    quote,
    recoveryScope,
    requestExpiresAt,
    signTransaction,
    walletAddress
  ]);

  if (!publicKey) {
    return <button className="primary-button" onClick={() => setVisible(true)} type="button">Choose wallet</button>;
  }

  if (failed) {
    return (
      <button
        className="secondary-button"
        onClick={() => {
          setFailed(false);
          setRetryVersion((current) => current + 1);
        }}
        type="button"
      >
        Try connected wallet again
      </button>
    );
  }

  return <p className="text-sm text-(--muted)">Check your connected wallet to review the transaction.</p>;
}

async function deliverExistingSubmission(
  record: PendingPaymentSubmission,
  connection: Connection,
  signal: AbortSignal
) {
  const rawTransaction = decodeBase64(record.signedTransactionBase64);
  const signedTransaction = Transaction.from(rawTransaction);
  if (
    signedTransaction.feePayer?.toBase58() !== record.walletAddress ||
    !signedTransaction.signature ||
    bs58.encode(signedTransaction.signature) !== record.signature
  ) {
    throw new Error("Retained payment transaction does not match its recovery record");
  }

  return deliverPendingPaymentSubmission(record, {
    async submitSignature(input, options) {
      await submitPaymentSignature(
        input.intentId,
        input.signature,
        input.signedTransactionBase64,
        input.idempotencyKey,
        options.signal
      );
    },
    broadcastSignedTransaction(signedTransactionBase64, options) {
      return coalescePaymentBroadcast(
        record.signature,
        () => connection.sendRawTransaction(decodeBase64(signedTransactionBase64)),
        { signal: options.signal }
      );
    }
  }, { signal });
}

function decodeBase64(value: string): Uint8Array {
  const binary = window.atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function encodeBase64(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return window.btoa(binary);
}
