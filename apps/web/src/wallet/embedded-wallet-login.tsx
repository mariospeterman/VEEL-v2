"use client";

import { usePrivy, useLogin } from "@privy-io/react-auth";
import {
  useCreateWallet,
  useSignMessage as usePrivySolanaSignMessage,
  useWallets as usePrivySolanaWallets
} from "@privy-io/react-auth/solana";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiMutationError, getCurrentSession } from "@/api-mutations";
import { safeMutationMessage } from "@/api-errors";
import { ProviderLogo } from "@/brand/provider-logo";
import { createBackendWalletSession } from "./backend-wallet-auth";
import type { WalletAuthPurpose } from "./backend-wallet-auth";
import { recordOnboardingEvent } from "@/analytics/onboarding-analytics";

export function EmbeddedWalletLoginButton({
  label,
  onAccountNotFound,
  onLinked,
  purpose,
  autoStart = false,
  secondary = false
}: {
  label: string;
  purpose: WalletAuthPurpose;
  onAccountNotFound?: (() => void) | undefined;
  onLinked?: ((address: string) => void) | undefined;
  autoStart?: boolean;
  secondary?: boolean;
}) {
  const { authenticated, ready } = usePrivy();
  const [flowRequested, setFlowRequested] = useState(false);
  const flowRunning = useRef(false);
  const { login } = useLogin({
    onError: () => {
      setFlowRequested(false);
      setState("error");
      setMessage("Sign-in was not completed. Try again when you are ready.");
    }
  });
  const { createWallet } = useCreateWallet();
  const { ready: walletsReady, wallets } = usePrivySolanaWallets();
  const { signMessage } = usePrivySolanaSignMessage();
  const [state, setState] = useState<"idle" | "working" | "account_not_found" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [walletProvisioned, setWalletProvisioned] = useState(false);
  const autoStarted = useRef(false);

  useEffect(() => {
    if (!flowRequested || !authenticated || !ready || !walletsReady || flowRunning.current) return;

    flowRunning.current = true;
    void (async () => {
      try {
        const wallet = wallets.find((candidate) => candidate.standardWallet.name === "Privy");

        if (!wallet) {
          if (purpose === "login") {
            recordOnboardingEvent("account_not_found");
            setFlowRequested(false);
            setState("account_not_found");
            setMessage("No existing WeVid wallet was found for this account. Start onboarding to create one.");
            return;
          }

          if (!walletProvisioned) {
            await createWallet();
            setWalletProvisioned(true);
            setMessage("Preparing your wallet…");
          }
          return;
        }

        await createBackendWalletSession({
          address: wallet.address,
          provider: "embedded_privy",
          purpose,
          signMessage: async (challenge) => {
            const result = await signMessage({
              message: new TextEncoder().encode(challenge),
              wallet
            });

            return result.signature;
          }
        });
        await getCurrentSession();

        setFlowRequested(false);
        onLinked?.(wallet.address);
        if (!onLinked) {
          window.location.reload();
        }
      } catch (error) {
        setFlowRequested(false);
        if (error instanceof ApiMutationError && error.status === 404 && purpose === "login") {
          recordOnboardingEvent("account_not_found");
          setState("account_not_found");
          setMessage("No WeVid account was found for this sign-in. Start onboarding to continue.");
          return;
        }
        setState("error");
        setMessage(safeMutationMessage(error, "Account sign-in"));
      } finally {
        flowRunning.current = false;
      }
    })();
  }, [authenticated, createWallet, flowRequested, onLinked, purpose, ready, signMessage, walletProvisioned, wallets, walletsReady]);

  const start = useCallback(() => {
    recordOnboardingEvent("auth_method_selected", `embedded-${purpose}`);
    setState("working");
    setMessage(null);
    setWalletProvisioned(false);

    if (!ready || !walletsReady) {
      setState("error");
      setMessage(safeMutationMessage(new ApiMutationError("Account sign-in is still loading."), "Account sign-in"));
      return;
    }

    setFlowRequested(true);
    if (!authenticated) {
      login();
    }
  }, [authenticated, login, ready, walletsReady]);

  useEffect(() => {
    if (!autoStart || autoStarted.current || !ready || !walletsReady) return;
    autoStarted.current = true;
    start();
  }, [autoStart, ready, start, walletsReady]);

  return (
    <>
      <EmbeddedButtonFrame
      disabled={state === "working"}
      label={label}
      logo="privy"
      message={message}
      onClick={start}
      secondary={secondary}
      status={state === "working" ? "Opening" : "Connect and sign"}
      tone={state === "error" ? "error" : "muted"}
      />
      {state === "account_not_found" && onAccountNotFound ? (
        <button className="landing-inline-link" onClick={onAccountNotFound} type="button">
          Start onboarding
        </button>
      ) : null}
    </>
  );
}

function EmbeddedButtonFrame({
  disabled,
  label,
  logo,
  message,
  onClick,
  secondary,
  status,
  tone
}: {
  disabled: boolean;
  label: string;
  logo: "privy";
  message: string | null;
  onClick: () => void;
  secondary: boolean;
  status: string;
  tone: "error" | "muted";
}) {
  return (
    <div className="auth-provider-button-stack">
      <button className={`auth-provider-button${secondary ? " auth-provider-button-secondary" : ""}`} disabled={disabled} onClick={onClick} type="button">
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
