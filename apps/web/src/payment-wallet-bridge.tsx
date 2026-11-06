"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Transaction } from "@solana/web3.js";
import bs58 from "bs58";
import { useEffect, useRef, useState } from "react";
import {
  createSolanaPayCheckoutTransaction,
  getCurrentSession,
  submitPaymentSignature,
  type TransactionRequest
} from "@/api-mutations";
import { createMutationIdempotencyKey } from "@/api-mutation-transport";
import { deliverPendingPaymentSubmission } from "@/payment-submission-delivery";
import {
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
  const { publicKey, signTransaction } = useWallet();
  const { setVisible } = useWalletModal();
  const startedAttempt = useRef<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [retryVersion, setRetryVersion] = useState(0);

  useEffect(() => {
    if (!intentId || !recoveryScope) return;
    if (request && (!publicKey || !request.checkoutUrl)) return;

    let disposed = false;
    let recoveryRetryTimer: number | undefined;
    const attemptKey = `${intentId}:${request ? "sign" : "recover"}:${retryVersion}`;
    if (startedAttempt.current === attemptKey) return;
    startedAttempt.current = attemptKey;
    setFailed(false);

    void (async () => {
      try {
        const session = await getCurrentSession();
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
          onSubmitted(existing);
          if (!request) {
            const result = await deliverExistingSubmission(existing);
            if (result !== "blocked" && result !== "accepted_expired") {
              scheduleRecoveryRetry();
            }
          }
          return;
        }

        if (!request || !quote || !publicKey || !signTransaction) {
          throw new Error("This wallet cannot safely sign a recoverable transaction");
        }

        await withPaymentAttemptLock(browserScope, async () => {
          const retained = readPendingPaymentSubmission(window.localStorage, browserScope);
          if (retained) {
            onSubmitted(retained);
            return;
          }

          const unsigned = await createSolanaPayCheckoutTransaction(
            request.checkoutUrl,
            publicKey.toBase58()
          );
          const transaction = Transaction.from(decodeBase64(unsigned.transaction));
          if (!transaction.feePayer?.equals(publicKey)) {
            throw new Error("Wallet request fee payer does not match the connected wallet");
          }

          const signedTransaction = await signTransaction(transaction);
          const signatureBytes = signedTransaction.signature;
          if (!signatureBytes) throw new Error("Wallet did not return a transaction signature");

          const candidate: PendingPaymentSubmission = {
            schemaVersion: 1,
            ...browserScope,
            intentId,
            walletAddress: publicKey.toBase58(),
            quote,
            signature: bs58.encode(signatureBytes),
            signedTransactionBase64: encodeBase64(signedTransaction.serialize()),
            idempotencyKey: createMutationIdempotencyKey(),
            intentExpiresAt: request.expiresAt,
            createdAt: new Date().toISOString()
          };
          const stored = storePendingPaymentSubmission(window.localStorage, candidate);

          // The submitted state hides every transaction-building path immediately. A recovery-only
          // runtime takes over and can replay only the retained bytes and command key.
          onSubmitted(stored.record);
        });
      } catch (error) {
        if (request) {
          setFailed(true);
          onError(error);
        } else {
          scheduleRecoveryRetry();
        }
      }
    })();

    function scheduleRecoveryRetry() {
      if (disposed || recoveryRetryTimer !== undefined) return;
      recoveryRetryTimer = window.setTimeout(() => {
        if (!disposed) setRetryVersion((current) => current + 1);
      }, 5_000);
    }

    async function deliverExistingSubmission(record: PendingPaymentSubmission) {
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
        async submitSignature(input) {
          await submitPaymentSignature(input.intentId, input.signature, input.idempotencyKey);
        },
        async broadcastSignedTransaction() {
          return connection.sendRawTransaction(rawTransaction);
        }
      });
    }

    return () => {
      disposed = true;
      if (recoveryRetryTimer !== undefined) window.clearTimeout(recoveryRetryTimer);
    };
  }, [
    connection,
    intentId,
    onError,
    onSubmitted,
    publicKey,
    quote,
    recoveryScope,
    request,
    retryVersion,
    signTransaction
  ]);

  if (!request) {
    return (
      <p className="text-sm text-(--muted)">
        Reusing the retained signed transaction while WeVid reconciles onchain settlement.
      </p>
    );
  }

  if (!publicKey) {
    return <button className="primary-button" onClick={() => setVisible(true)} type="button">Choose wallet</button>;
  }

  if (failed) {
    return (
      <button
        className="secondary-button"
        onClick={() => {
          startedAttempt.current = null;
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

async function withPaymentAttemptLock<T>(
  scope: PaymentSubmissionBrowserScope,
  work: () => Promise<T>
): Promise<T> {
  if (!navigator.locks?.request) return work();
  return navigator.locks.request(
    `wevid-payment:${paymentSubmissionRecoveryKey(scope)}`,
    { mode: "exclusive" },
    work
  );
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
