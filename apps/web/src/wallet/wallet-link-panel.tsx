"use client";

import { useEffect, useMemo, useState } from "react";
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
import { bytesToBase64, createBackendWalletSession, walletChain } from "./backend-wallet-auth";
import { clearWalletSession } from "./wallet-session";

type ExternalWalletProvider = LinkWalletRequest["provider"];

interface WalletLinkPanelProps {
  authState: WebAuthState;
  compact?: boolean;
  loginSimple?: boolean;
  onLinked?: ((address: string) => void) | undefined;
  reloadOnSession?: boolean;
}

export function WalletLinkPanel({ authState, compact = false, loginSimple = false, onLinked, reloadOnSession = true }: WalletLinkPanelProps) {
  const { connect, connected, connecting, disconnect, publicKey, signMessage, wallet, wallets } = useWallet();
  const { setVisible: setWalletModalVisible } = useWalletModal();
  const [mounted, setMounted] = useState(false);
  const [awaitingWallet, setAwaitingWallet] = useState(false);
  const [state, setState] = useState<"idle" | "linking" | "linked" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [linkedAddress, setLinkedAddress] = useState<string | null>(null);

  const detectedWallets = useMemo(
    () =>
      wallets
        .filter((wallet) => wallet.readyState !== WalletReadyState.Unsupported)
        .map((wallet) => ({ label: wallet.adapter.name, provider: providerForWallet(wallet) })),
    [wallets]
  );

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!awaitingWallet || state === "linking" || !wallet) {
      return;
    }

    if (connected && publicKey) {
      void completeConnectedWallet(wallet);
      return;
    }

    if (!connecting) {
      void connectSelectedWallet();
    }
  }, [awaitingWallet, connected, connecting, publicKey, state, wallet]);

  function startWalletFlow() {
    setMessage(null);
    setAwaitingWallet(true);

    if (!connected || !publicKey || !wallet) {
      setWalletModalVisible(true);
      return;
    }

    void completeConnectedWallet(wallet);
  }

  async function chooseAnotherWallet() {
    setMessage(null);
    setAwaitingWallet(true);

    try {
      if (connected) {
        await disconnect();
      }
    } catch {
      // Continue into the modal; the adapter can still present available wallets.
    } finally {
      setWalletModalVisible(true);
    }
  }

  async function disconnectWallet() {
    setMessage(null);
    setAwaitingWallet(false);

    try {
      if (connected) {
        await disconnect();
      }
    } finally {
      clearWalletSession();
      setLinkedAddress(null);
      setState("idle");
      setMessage("Wallet disconnected.");
    }
  }

  async function connectSelectedWallet() {
    try {
      await connect();
    } catch (error) {
      setAwaitingWallet(false);
      setState("error");
      setMessage(walletMutationMessage(error));
    }
  }

  async function completeConnectedWallet(selectedWallet: Wallet) {
    setState("linking");
    setMessage(null);

    try {
      const walletProvider = providerForWallet(selectedWallet);

      if (!signMessage) {
        throw new ApiMutationError(`${selectedWallet.adapter.name} is connected but does not expose message signing.`);
      }

      const address = publicKey?.toString();

      if (!address) {
        throw new ApiMutationError("Wallet did not return a public address.");
      }

      const chain = walletChain();

      if (!authState.authenticated || authState.method === "wallet") {
        await createBackendWalletSession({
          address,
          provider: walletProvider,
          signMessage: (message) => signMessage(new TextEncoder().encode(message))
        });

        setLinkedAddress(address);
        setState("linked");
        setAwaitingWallet(false);
        setMessage("Wallet session created. Continue with profile and age verification.");
        onLinked?.(address);
        if (reloadOnSession) {
          await redirectAfterWalletSession();
        }
        return;
      }

      const challenge = await createWalletLinkChallenge({
        address,
        chain,
        provider: walletProvider
      });
      const signature = await signMessage(new TextEncoder().encode(challenge.message));

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

      setLinkedAddress(address);
      setState("linked");
      setAwaitingWallet(false);
      setMessage("Wallet linked. Access still depends on backend age and policy state.");
      onLinked?.(address);
    } catch (error) {
      setAwaitingWallet(false);
      setState("error");
      setMessage(walletMutationMessage(error));
    }
  }

  return (
    <section className={`auth-wallet-connect-card ${loginSimple ? "auth-wallet-connect-simple" : ""}`}>
      {!loginSimple && (
        <div>
          <p className="text-xs font-semibold uppercase text-(--accent)">Wallet</p>
          <h2 className="mt-2 text-base font-semibold tracking-normal">
            {authState.method === "supabase" ? "Link Solana wallet" : "Enter with Solana"}
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

      {!loginSimple && mounted && detectedWallets.length > 0 && (
        <div className="auth-wallet-detected" aria-label="Detected wallet support">
          <p>Detected</p>
          <div>
            {detectedWallets.map((wallet) => (
              <span key={`${wallet.provider}-${wallet.label}`}>{wallet.label}</span>
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
            <button
              className="auth-provider-button"
              disabled={state === "linking" || connecting}
              onClick={startWalletFlow}
              type="button"
            >
              <ProviderLogo label="Connect wallet" name="wallet" />
              <span>
                <strong>{connected && publicKey ? "Continue" : "Connect wallet"}</strong>
                <small>{state === "linking" || connecting ? "Waiting" : connected && publicKey ? shortWalletAddress(publicKey.toString()) : "Choose wallet"}</small>
              </span>
            </button>
            {connected ? (
              <>
                <button
                  className="auth-provider-button auth-provider-button-secondary"
                  disabled={state === "linking" || connecting}
                  onClick={() => void chooseAnotherWallet()}
                  type="button"
                >
                  <ProviderLogo label="Choose another wallet" name="wallet" />
                  <span>
                    <strong>Switch</strong>
                    <small>Choose another</small>
                  </span>
                </button>
                <button
                  className="auth-provider-button auth-provider-button-secondary"
                  disabled={state === "linking" || connecting}
                  onClick={() => void disconnectWallet()}
                  type="button"
                >
                  <ProviderLogo label="Disconnect wallet" name="wallet" />
                  <span>
                    <strong>Disconnect</strong>
                    <small>Clear session</small>
                  </span>
                </button>
              </>
            ) : null}
          </div>
        </>
      ) : (
        <button
          className="auth-wallet-primary-button"
          disabled={state === "linking" || connecting}
          onClick={startWalletFlow}
          type="button"
        >
          <span>{state === "linking" || connecting ? "Waiting for wallet" : authState.method === "supabase" ? "Connect and link" : "Connect wallet"}</span>
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
    </section>
  );
}

function shortWalletAddress(address: string) {
  return address.length > 10 ? `${address.slice(0, 4)}...${address.slice(-4)}` : address;
}

async function redirectAfterWalletSession() {
  try {
    const session = await getCurrentSession();
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
  } catch {
    window.location.assign("/?mode=onboarding&step=profile&next=%2Fapp%2Fhome");
  }
}

function walletNameIncludes(wallet: Wallet, value: string) {
  return wallet.adapter.name.toLowerCase().includes(value);
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

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs uppercase text-(--muted)">{label}</p>
      <p className="mt-1 truncate font-medium">{value}</p>
    </div>
  );
}
