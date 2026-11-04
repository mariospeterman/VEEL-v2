"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Transaction } from "@solana/web3.js";
import { useEffect, useRef, useState } from "react";
import {
  createSolanaPayCheckoutTransaction,
  submitPaymentSignature,
  type TransactionRequest
} from "@/api-mutations";

export function PaymentWalletBridge({
  intentId,
  onError,
  onSubmitted,
  request
}: {
  intentId: string;
  onError: (error: unknown) => void;
  onSubmitted: () => void;
  request: TransactionRequest;
}) {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const { setVisible } = useWalletModal();
  const startedIntentId = useRef<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [retryVersion, setRetryVersion] = useState(0);

  useEffect(() => {
    if (!intentId || !publicKey || !request.checkoutUrl || startedIntentId.current === intentId) return;
    const checkoutUrl = request.checkoutUrl;
    startedIntentId.current = intentId;
    setFailed(false);

    void (async () => {
      try {
        const unsigned = await createSolanaPayCheckoutTransaction(
          checkoutUrl,
          publicKey.toBase58()
        );
        const transaction = Transaction.from(decodeBase64(unsigned.transaction));
        const signature = await sendTransaction(transaction, connection);
        await submitPaymentSignature(intentId, signature);
        onSubmitted();
      } catch (error) {
        setFailed(true);
        onError(error);
      }
    })();
  }, [connection, intentId, onError, onSubmitted, publicKey, request.checkoutUrl, retryVersion, sendTransaction]);

  if (!publicKey) {
    return <button className="primary-button" onClick={() => setVisible(true)} type="button">Choose wallet</button>;
  }

  if (failed) {
    return (
      <button
        className="secondary-button"
        onClick={() => {
          startedIntentId.current = null;
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

function decodeBase64(value: string) {
  const binary = window.atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
