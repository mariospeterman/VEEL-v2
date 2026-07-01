"use client";

import { useEffect, useMemo, useState } from "react";
import { WalletReadyState } from "@solana/wallet-adapter-base";
import { useWallet, type Wallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import {
  ApiMutationError,
  createWalletLinkChallenge,
  linkWallet,
  type LinkWalletRequest
} from "@/api-mutations";
import { ProviderLogo } from "@/brand/provider-logo";
import { safeMutationMessage } from "@/api-errors";
import type { WebAuthState } from "@/supabase/auth-state";
import { bytesToBase64, createBackendWalletSession, walletChain } from "./backend-wallet-auth";

type ExternalWalletProvider = LinkWalletRequest["provider"];

interface WalletLinkPanelProps {
  authState: WebAuthState;
  compact?: boolean;
  loginSimple?: boolean;
  onLinked?: ((address: string) => void) | undefined;
  reloadOnSession?: boolean;
}

export function WalletLinkPanel({ authState, compact = false, loginSimple = false, onLinked, reloadOnSession = true }: WalletLinkPanelProps) {
  const { connect, connected, connecting, publicKey, signMessage, wallet, wallets } = useWallet();
  const { setVisible: setWalletModalVisible } = useWalletModal();
  const [mounted, setMounted] = useState(false);
  const [awaitingWallet, setAwaitingWallet] = useState(false);
  const [state, setState] = useState<"idle" | "linking" | "linked" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [linkedAddress, setLinkedAddress] = useState<string | null>(null);

  const detectedWallets = useMemo(
    () =>
      wallets
        .filter(isAllowedSolanaWallet)
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
          window.location.reload();
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
                <strong>Connect wallet</strong>
                <small>{state === "linking" || connecting ? "Waiting" : "Choose wallet"}</small>
              </span>
            </button>
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

function walletNameIncludes(wallet: Wallet, value: string) {
  return wallet.adapter.name.toLowerCase().includes(value);
}

function isAllowedSolanaWallet(wallet: Wallet) {
  const name = wallet.adapter.name.toLowerCase();

  if (isKnownEvmOnlyWalletName(name)) {
    return false;
  }

  return isKnownSolanaWalletName(name) || wallet.readyState === WalletReadyState.Installed || wallet.readyState === WalletReadyState.Loadable;
}

function isKnownSolanaWalletName(name: string) {
  return (
    name.includes("backpack") ||
    name.includes("glow") ||
    name.includes("phantom") ||
    name.includes("solana mobile") ||
    name.includes("solflare") ||
    name.includes("ultimate")
  );
}

function isKnownEvmOnlyWalletName(name: string) {
  return (
    name.includes("coinbase") ||
    name.includes("metamask") ||
    name.includes("rabby") ||
    name.includes("rainbow") ||
    name.includes("safepal") ||
    name.includes("trust wallet")
  );
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
