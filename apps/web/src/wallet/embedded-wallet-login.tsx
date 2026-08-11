"use client";

import { usePrivy, useLogin } from "@privy-io/react-auth";
import {
  useCreateWallet,
  useSignMessage as usePrivySolanaSignMessage,
  useWallets as usePrivySolanaWallets
} from "@privy-io/react-auth/solana";
import { useState } from "react";
import { ApiMutationError } from "@/api-mutations";
import { safeMutationMessage } from "@/api-errors";
import { ProviderLogo } from "@/brand/provider-logo";
import { createBackendWalletSession } from "./backend-wallet-auth";

export function EmbeddedWalletLoginButton({
  label,
  onLinked
}: {
  label: string;
  onLinked?: ((address: string) => void) | undefined;
}) {
  const { authenticated, ready } = usePrivy();
  const { login } = useLogin();
  const { createWallet } = useCreateWallet();
  const { ready: walletsReady, wallets } = usePrivySolanaWallets();
  const { signMessage } = usePrivySolanaSignMessage();
  const [state, setState] = useState<"idle" | "working" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function start() {
    setState("working");
    setMessage(null);

    try {
      if (!ready || !walletsReady) {
        throw new ApiMutationError("Privy is still loading.");
      }

      if (!authenticated) {
        login();
        setState("idle");
        setMessage("Finish Privy login, then continue.");
        return;
      }

      const wallet = wallets.find((candidate) => candidate.standardWallet.name === "Privy");

      if (!wallet) {
        await createWallet();
        setState("idle");
        setMessage("Privy wallet created. Continue again to sign the WeVid challenge.");
        return;
      }

      await createBackendWalletSession({
        address: wallet.address,
        provider: "embedded_privy",
        signMessage: async (challenge) => {
          const result = await signMessage({
            message: new TextEncoder().encode(challenge),
            wallet
          });

          return result.signature;
        }
      });

      onLinked?.(wallet.address);
      if (!onLinked) {
        window.location.reload();
      }
    } catch (error) {
      setState("error");
      setMessage(safeMutationMessage(error, "Embedded wallet login"));
    }
  }

  return (
    <EmbeddedButtonFrame
      disabled={state === "working"}
      label={label}
      logo="privy"
      message={message}
      onClick={() => void start()}
      status={state === "working" ? "Opening" : "Connect and sign"}
      tone={state === "error" ? "error" : "muted"}
    />
  );
}

function EmbeddedButtonFrame({
  disabled,
  label,
  logo,
  message,
  onClick,
  status,
  tone
}: {
  disabled: boolean;
  label: string;
  logo: "privy";
  message: string | null;
  onClick: () => void;
  status: string;
  tone: "error" | "muted";
}) {
  return (
    <div className="auth-provider-button-stack">
      <button className="auth-provider-button" disabled={disabled} onClick={onClick} type="button">
        <ProviderLogo label={label} name={logo} />
        <span>
          <strong>{label}</strong>
          <small>{status}</small>
        </span>
      </button>
      {message ? <p className={`auth-provider-note auth-provider-note-${tone}`}>{message}</p> : null}
    </div>
  );
}
