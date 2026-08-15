"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { Transaction } from "@solana/web3.js";
import { useEffect, useRef } from "react";
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
  const startedIntentId = useRef<string | null>(null);

  useEffect(() => {
    if (!intentId || !publicKey || !request.checkoutUrl || startedIntentId.current === intentId) return;
    const checkoutUrl = request.checkoutUrl;
    startedIntentId.current = intentId;

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
        onError(error);
      }
    })();
  }, [connection, intentId, onError, onSubmitted, publicKey, request.checkoutUrl, sendTransaction]);

  return null;
}

function decodeBase64(value: string) {
  const binary = window.atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
