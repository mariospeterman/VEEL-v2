"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { WalletReadyState } from "@solana/wallet-adapter-base";
import { useWallet, type Wallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import {
  ApiMutationError,
  createWalletLinkChallenge,
  getCurrentSession,
  linkWallet,
  type LinkWalletRequest
} from "@/api-mutations";
import { ProviderLogo } from "@/brand/provider-logo";
import { safeMutationMessage } from "@/api-errors";
import type { WebAuthState } from "@/supabase/auth-state";
import { bytesToBase64, createBackendWalletSession, walletChain, type WalletAuthPurpose } from "./backend-wallet-auth";
import { recordOnboardingEvent } from "@/analytics/onboarding-analytics";

type ExternalWalletProvider = LinkWalletRequest["provider"];

interface WalletLinkPanelProps {
  authState: WebAuthState;
  autoStart?: boolean;
  children?: ReactNode;
  compact?: boolean;
  loginSimple?: boolean;
  authPurpose?: WalletAuthPurpose;
  onAccountNotFound?: (() => void) | undefined;
  onLinked?: ((address: string) => void) | undefined;
  reloadOnSession?: boolean;
}

export function WalletLinkPanel({ autoStart = false, authState, authPurpose = "login", children, compact = false, loginSimple = false, onAccountNotFound, onLinked, reloadOnSession = true }: WalletLinkPanelProps) {
  const { connect, connected, connecting, disconnect, publicKey, select, signMessage, wallet, wallets } = useWallet();
  const { setVisible: setWalletModalVisible } = useWalletModal();
  const [mounted, setMounted] = useState(false);
  const [awaitingWallet, setAwaitingWallet] = useState(false);
  const [state, setState] = useState<"idle" | "linking" | "linked" | "account_not_found" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [linkedAddress, setLinkedAddress] = useState<string | null>(null);
  const primaryButtonRef = useRef<HTMLButtonElement | null>(null);
  const autoStartHandledRef = useRef(false);
  const connectionAttemptRef = useRef<string | null>(null);
  const authAttemptRef = useRef<{ controller: AbortController; id: number; timeout: number } | null>(null);
  const authAttemptIdRef = useRef(0);

  const detectedWallets = useMemo(
    () =>
      wallets
        .filter((wallet) => wallet.readyState !== WalletReadyState.Unsupported)
        .sort((left, right) => walletSortRank(left) - walletSortRank(right)),
    [wallets]
  );
  const hasDetectedWallets = mounted && detectedWallets.length > 0;

  useEffect(() => {
    setMounted(true);

    return () => {
      cancelAuthAttempt();
    };
  }, []);

  useEffect(() => {
    if (!autoStart || !mounted || autoStartHandledRef.current) return;
    autoStartHandledRef.current = true;
    primaryButtonRef.current?.click();
  }, [autoStart, mounted]);

  useEffect(() => {
    if (!awaitingWallet || state === "linking" || !wallet) {
      return;
    }

    if (connected && publicKey) {
      void completeConnectedWallet(wallet);
      return;
    }

    if (!connecting && connectionAttemptRef.current !== wallet.adapter.name) {
      void connectSelectedWallet();
    }
  }, [awaitingWallet, connected, connecting, publicKey, state, wallet]);

  function startWalletFlow() {
    recordOnboardingEvent("auth_method_selected", `external-${authPurpose}`);
    cancelAuthAttempt();
    setMessage(null);
    setState("idle");
    setAwaitingWallet(true);

    if (!connected || !publicKey || !wallet) {
      setWalletModalVisible(true);
      return;
    }

    void completeConnectedWallet(wallet);
  }

  async function chooseWallet(selectedWallet: Wallet) {
    recordOnboardingEvent("auth_method_selected", `external-${authPurpose}`);
    cancelAuthAttempt();
    setMessage(null);
    setState("idle");
    setAwaitingWallet(true);

    try {
      if (wallet && wallet.adapter.name !== selectedWallet.adapter.name && connected) {
        await disconnect();
      }

      if (!wallet || wallet.adapter.name !== selectedWallet.adapter.name) {
        select(selectedWallet.adapter.name);
      }

      if (!selectedWallet.adapter.connected) {
        connectionAttemptRef.current = selectedWallet.adapter.name;
        try {
          await selectedWallet.adapter.connect();
        } finally {
          if (connectionAttemptRef.current === selectedWallet.adapter.name) {
            connectionAttemptRef.current = null;
          }
        }
      }

      await completeConnectedWallet(selectedWallet);
    } catch {
      setAwaitingWallet(false);
      setState("error");
      setMessage("That wallet could not be selected. Unlock it and try again.");
    }
  }

  async function disconnectWallet() {
    cancelAuthAttempt();
    setMessage(null);
    setAwaitingWallet(false);

    try {
      if (connected) {
        await disconnect();
      }
    } finally {
      setLinkedAddress(null);
      setState("idle");
      setMessage("Wallet disconnected.");
    }
  }

  async function connectSelectedWallet() {
    const selectedWalletName = wallet?.adapter.name;
    if (!selectedWalletName || connectionAttemptRef.current === selectedWalletName) return;
    connectionAttemptRef.current = selectedWalletName;

    try {
      await connect();
    } catch (error) {
      setAwaitingWallet(false);
      setState("error");
      setMessage(walletMutationMessage(error));
    } finally {
      if (connectionAttemptRef.current === selectedWalletName) {
        connectionAttemptRef.current = null;
      }
    }
  }

  async function completeConnectedWallet(selectedWallet: Wallet) {
    if (authAttemptRef.current) return;

    const attempt = beginAuthAttempt();
    setState("linking");
    setMessage("Check your wallet and sign the ownership message. No payment is requested.");

    try {
      const walletProvider = providerForWallet(selectedWallet);

      const adapterSignMessage = "signMessage" in selectedWallet.adapter && typeof selectedWallet.adapter.signMessage === "function"
        ? selectedWallet.adapter.signMessage.bind(selectedWallet.adapter)
        : signMessage;

      if (!adapterSignMessage) {
        throw new ApiMutationError(`${selectedWallet.adapter.name} is connected but does not expose message signing.`);
      }

      const address = selectedWallet.adapter.publicKey?.toString() ?? publicKey?.toString();

      if (!address) {
        throw new ApiMutationError("Wallet did not return a public address.");
      }

      const chain = walletChain();

      if (!authState.authenticated || authState.method === "wallet") {
        await createBackendWalletSession({
          address,
          provider: walletProvider,
          purpose: authPurpose,
          signal: attempt.controller.signal,
          signMessage: (message) => adapterSignMessage(new TextEncoder().encode(message))
        });
        if (!isCurrentAuthAttempt(attempt.id)) return;
        const appSession = await getCurrentSession();
        if (!isCurrentAuthAttempt(attempt.id)) return;

        setLinkedAddress(address);
        setState("linked");
        setAwaitingWallet(false);
        setMessage(authPurpose === "login" ? "Welcome back." : "Wallet verified. Continue with your profile.");
        onLinked?.(address);
        if (reloadOnSession) {
          redirectAfterWalletSession(appSession);
        }
        return;
      }

      const challenge = await createWalletLinkChallenge({
        address,
        chain,
        provider: walletProvider
      });
      if (!isCurrentAuthAttempt(attempt.id)) return;
      const signature = await adapterSignMessage(new TextEncoder().encode(challenge.message));
      if (!isCurrentAuthAttempt(attempt.id)) return;

      await linkWallet({
        address,
        chain,
        provider: walletProvider,
        proof: {
          challengeId: challenge.id,
          message: challenge.message,
          signature: bytesToBase64(signature),
          signatureEncoding: "base64"
        }
      });
      if (!isCurrentAuthAttempt(attempt.id)) return;

      setLinkedAddress(address);
      setState("linked");
      setAwaitingWallet(false);
      setMessage("Wallet linked. Access still depends on backend age and policy state.");
      onLinked?.(address);
    } catch (error) {
      if (isWalletFlowCancellation(error)) {
        if (isCurrentAuthAttempt(attempt.id)) {
          setAwaitingWallet(false);
          setState("idle");
          setMessage("Wallet sign-in stopped. Choose a method when you are ready.");
        }
        return;
      }

      setAwaitingWallet(false);
      if (error instanceof ApiMutationError && error.status === 404 && authPurpose === "login") {
        setState("account_not_found");
        setMessage("No WeVid account was found for this wallet. Start onboarding with this wallet to continue.");
        return;
      }
      setState("error");
      setMessage(walletMutationMessage(error));
    } finally {
      finishAuthAttempt(attempt.id);
    }
  }

  function beginAuthAttempt() {
    cancelAuthAttempt();
    const id = authAttemptIdRef.current + 1;
    authAttemptIdRef.current = id;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 45_000);
    const attempt = { controller, id, timeout };
    authAttemptRef.current = attempt;
    return attempt;
  }

  function cancelAuthAttempt() {
    const attempt = authAttemptRef.current;
    if (!attempt) return;
    window.clearTimeout(attempt.timeout);
    attempt.controller.abort();
    authAttemptRef.current = null;
  }

  function finishAuthAttempt(id: number) {
    const attempt = authAttemptRef.current;
    if (!attempt || attempt.id !== id) return;
    window.clearTimeout(attempt.timeout);
    authAttemptRef.current = null;
  }

  function isCurrentAuthAttempt(id: number) {
    return authAttemptRef.current?.id === id;
  }

  return (
    <section className={`auth-wallet-connect-card ${loginSimple ? "auth-wallet-connect-simple" : ""}`}>
      {!loginSimple && (
        <div>
          <p className="text-xs font-semibold uppercase text-(--accent-text)">Wallet</p>
          <h2 className="mt-2 text-base font-semibold tracking-normal">
            Enter with Solana
          </h2>
          <p className="mt-2 text-sm leading-6 text-(--muted)">
            Choose a Solana wallet and sign the backend challenge. This proves ownership only.
          </p>
        </div>
      )}

      {!compact && !loginSimple && (
        <div className="grid gap-2 text-sm sm:grid-cols-3">
          <Fact label="Network" value={walletChain() === "solana_devnet" ? "devnet" : "mainnet"} />
          <Fact label="Signature" value="ownership only" />
          <Fact label="Access" value="backend decided" />
        </div>
      )}

      {!loginSimple && hasDetectedWallets && (
        <div className="auth-wallet-detected" aria-label="Detected wallet support">
          <p>Detected</p>
          <div>
            {detectedWallets.map((wallet) => (
              <span key={wallet.adapter.name}>{wallet.adapter.name}</span>
            ))}
          </div>
        </div>
      )}

      {!loginSimple && (
        <div className="auth-login-wallet-icons" aria-label="Supported wallet options">
          <span>
            <ProviderLogo label="Connect wallet" name="wallet" />
            <span>Solana Wallet Adapter</span>
          </span>
        </div>
      )}

      {loginSimple ? (
        <>
          <div className="auth-provider-button-grid auth-provider-button-grid-wallets" aria-label="Wallet login providers">
            {mounted ? detectedWallets.map((detectedWallet) => {
              const active = wallet?.adapter.name === detectedWallet.adapter.name;
              const busy = active && (state === "linking" || connecting);

              return (
                <button
                  aria-label={`${authPurpose === "login" ? "Continue" : "Set up"} with ${detectedWallet.adapter.name}`}
                  className={`auth-provider-button${active ? " auth-provider-button-active" : ""}`}
                  disabled={busy}
                  key={detectedWallet.adapter.name}
                  onClick={() => void chooseWallet(detectedWallet)}
                  type="button"
                >
                  <ProviderLogo label={detectedWallet.adapter.name} name={logoForWallet(detectedWallet)} />
                  <span>
                    <strong>{detectedWallet.adapter.name}</strong>
                    <small>{busy ? state === "linking" ? "Check wallet" : "Opening" : active && publicKey ? shortWalletAddress(publicKey.toString()) : "Connect and sign"}</small>
                  </span>
                </button>
              );
            }) : null}
            {children}
            <button
              aria-label={!hasDetectedWallets ? authPurpose === "login" ? "Choose a wallet" : "Choose an external wallet" : "More wallet options"}
              className="auth-provider-button auth-provider-button-secondary"
              disabled={state === "linking" || connecting}
              onClick={startWalletFlow}
              ref={primaryButtonRef}
              type="button"
            >
              <ProviderLogo label="Wallet options" name="wallet" />
              <span>
                <strong>{!hasDetectedWallets ? "Choose wallet" : "More wallets"}</strong>
                <small>{state === "linking" || connecting ? "Waiting" : !hasDetectedWallets ? "View available wallets" : "Open wallet list"}</small>
              </span>
            </button>
          </div>
          {connected || state === "linking" ? (
            <div className="auth-wallet-session-actions">
              <span>{wallet ? `${wallet.adapter.name}${publicKey ? ` · ${shortWalletAddress(publicKey.toString())}` : ""}` : "Wallet request active"}</span>
              <button onClick={() => void disconnectWallet()} type="button">
                {state === "linking" ? "Stop and disconnect" : "Disconnect"}
              </button>
            </div>
          ) : null}
        </>
      ) : (
        <button
          className="auth-wallet-primary-button"
          disabled={state === "linking" || connecting}
          onClick={startWalletFlow}
          type="button"
        >
          <span>{state === "linking" || connecting ? "Waiting for wallet" : "Connect wallet"}</span>
        </button>
      )}

      {linkedAddress ? <p className="truncate text-sm text-(--muted)">Linked {linkedAddress}</p> : null}

      {message ? (
        <p
          className="auth-wallet-message"
          data-state={state}
        >
          {message}
        </p>
      ) : null}
      {state === "account_not_found" && onAccountNotFound ? (
        <button className="landing-inline-link" onClick={onAccountNotFound} type="button">
          Start onboarding
        </button>
      ) : null}
    </section>
  );
}

function shortWalletAddress(address: string) {
  return address.length > 10 ? `${address.slice(0, 4)}...${address.slice(-4)}` : address;
}

function redirectAfterWalletSession(session: Awaited<ReturnType<typeof getCurrentSession>>) {
  const reason = session.appAccessState.reason;

  if (session.appAccessState.allowed) {
    window.location.assign("/app/home");
    return;
  }

  if (reason === "age_required" || reason === "age_pending") {
    window.location.assign("/?mode=onboarding&step=age&next=%2Fapp%2Fhome");
    return;
  }

  if (reason === "identity_required" || reason === "wallet_required") {
    window.location.assign("/?mode=onboarding&step=profile&next=%2Fapp%2Fhome");
    return;
  }

  window.location.assign("/?mode=login&next=%2Fapp%2Fhome");
}

function walletNameIncludes(wallet: Wallet, value: string) {
  return wallet.adapter.name.toLowerCase().includes(value);
}

function logoForWallet(wallet: Wallet): "backpack" | "phantom" | "solflare" | "wallet" {
  if (walletNameIncludes(wallet, "backpack")) return "backpack";
  if (walletNameIncludes(wallet, "phantom")) return "phantom";
  if (walletNameIncludes(wallet, "solflare")) return "solflare";
  return "wallet";
}

function walletSortRank(wallet: Wallet) {
  const logo = logoForWallet(wallet);
  if (logo === "phantom") return 0;
  if (logo === "backpack") return 1;
  if (logo === "solflare") return 2;
  return 3;
}

function providerForWallet(wallet: Wallet | null): ExternalWalletProvider {
  if (!wallet) {
    return "wallet_adapter";
  }

  if (walletNameIncludes(wallet, "phantom")) {
    return "phantom";
  }

  if (walletNameIncludes(wallet, "solflare")) {
    return "solflare";
  }

  return "wallet_adapter";
}

function walletMutationMessage(error: unknown) {
  if (error instanceof Error) {
    const name = error.name.toLowerCase();

    if (name.includes("notready")) {
      return "That wallet is not installed or is not ready in this browser. Install or unlock it, then try again.";
    }

    if (name.includes("notselected")) {
      return "Choose a wallet first.";
    }

    if (name.includes("userreject") || name.includes("rejected")) {
      return "Wallet request was cancelled.";
    }

    if (name.includes("connection")) {
      return error.message || "Wallet connection failed. Unlock the wallet and try again.";
    }
  }

  return safeMutationMessage(error, "Wallet connection");
}

function isWalletFlowCancellation(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs uppercase text-(--muted)">{label}</p>
      <p className="mt-1 truncate font-medium">{value}</p>
    </div>
  );
}
