"use client";

import { useState } from "react";
import {
  ApiMutationError,
  createWalletAuthChallenge,
  createWalletAuthSession,
  createWalletLinkChallenge,
  linkWallet,
  type LinkWalletRequest
} from "@/api-mutations";
import type { WebAuthState } from "@/supabase/auth-state";
import { saveWalletSession } from "./wallet-session";

type ExternalWalletProvider = LinkWalletRequest["provider"];
type WalletChain = LinkWalletRequest["chain"];

interface WalletLinkPanelProps {
  authState: WebAuthState;
  compact?: boolean;
}

interface InjectedSolanaProvider {
  isPhantom?: boolean;
  isSolflare?: boolean;
  publicKey?: { toString(): string };
  connect(options?: { onlyIfTrusted?: boolean }): Promise<{ publicKey?: { toString(): string } } | void>;
  signMessage(message: Uint8Array, display?: "utf8" | "hex"): Promise<{ signature: Uint8Array } | Uint8Array>;
}

declare global {
  interface Window {
    solana?: InjectedSolanaProvider;
    phantom?: {
      solana?: InjectedSolanaProvider;
    };
    solflare?: InjectedSolanaProvider;
  }
}

export function WalletLinkPanel({ authState, compact = false }: WalletLinkPanelProps) {
  const [state, setState] = useState<"idle" | "linking" | "linked" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [linkedAddress, setLinkedAddress] = useState<string | null>(null);
  const mobileReturnUrl =
    typeof window === "undefined" ? "" : encodeURIComponent(window.location.origin);

  async function linkInjectedWallet() {
    setState("linking");
    setMessage(null);

    try {
      const provider = getInjectedSolanaProvider();
      if (!provider) {
        throw new ApiMutationError("Install or unlock a Solana wallet that supports message signing.");
      }

      const connection = await provider.connect();
      const address = connection?.publicKey?.toString() ?? provider.publicKey?.toString();

      if (!address) {
        throw new ApiMutationError("Wallet did not return a public address.");
      }

      const walletProvider = providerName(provider);
      const chain = walletChain();

      if (!authState.authenticated || authState.method === "wallet") {
        const challenge = await createWalletAuthChallenge({
          address,
          chain,
          provider: walletProvider
        });
        const signed = await provider.signMessage(new TextEncoder().encode(challenge.message), "utf8");
        const signature = signed instanceof Uint8Array ? signed : signed.signature;
        const session = await createWalletAuthSession({
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

        saveWalletSession({
          accessToken: session.accessToken,
          expiresAt: session.expiresAt,
          address: session.wallet.address,
          provider: session.wallet.provider
        });

        setLinkedAddress(address);
        setState("linked");
        setMessage("Wallet session created. Continue with profile and age verification.");
        window.location.reload();
        return;
      }

      const challenge = await createWalletLinkChallenge({
        address,
        chain,
        provider: walletProvider
      });
      const signed = await provider.signMessage(new TextEncoder().encode(challenge.message), "utf8");
      const signature = signed instanceof Uint8Array ? signed : signed.signature;

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
      setMessage("Wallet linked. Access still depends on backend age and policy state.");
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Wallet link failed");
    }
  }

  return (
    <section className="grid gap-3 rounded border border-(--line) bg-(--background) p-4">
      <div>
        <p className="text-xs font-semibold uppercase text-(--accent)">Wallet</p>
        <h2 className="mt-2 text-base font-semibold tracking-normal">
          {authState.method === "supabase" ? "Link Solana wallet" : "Enter with Solana"}
        </h2>
        <p className="mt-2 text-sm leading-6 text-(--muted)">
          Sign a backend-issued ownership challenge. This creates your Veel session, never moves
          funds, and never proves payment.
        </p>
      </div>

      {compact ? null : (
        <div className="grid gap-2 text-sm sm:grid-cols-3">
          <Fact label="Network" value={walletChain() === "solana_devnet" ? "devnet" : "mainnet"} />
          <Fact label="Signature" value="ownership only" />
          <Fact label="Access" value="backend decided" />
        </div>
      )}

      <button
        className="rounded bg-(--foreground) px-4 py-3 text-sm font-semibold text-(--background) disabled:cursor-not-allowed disabled:opacity-60"
        disabled={state === "linking"}
        onClick={linkInjectedWallet}
        type="button"
      >
        {state === "linking" ? "Waiting for wallet" : authState.method === "supabase" ? "Connect and link" : "Connect wallet"}
      </button>

      <div className="grid gap-2 text-xs text-(--muted)">
        <a className="underline-offset-4 hover:underline" href={`https://phantom.app/ul/browse/${mobileReturnUrl}`}>
          Open Phantom on iOS
        </a>
        <a className="underline-offset-4 hover:underline" href={`https://solflare.com/ul/v1/browse/${mobileReturnUrl}`}>
          Open Solflare mobile
        </a>
      </div>

      {linkedAddress ? <p className="truncate text-sm text-(--muted)">Linked {linkedAddress}</p> : null}

      {message ? (
        <p
          className={`rounded border px-3 py-2 text-sm ${
            state === "error"
              ? "border-[#7f1d1d] bg-[#450a0a] text-[#fecaca]"
              : "border-(--line) bg-(--panel) text-(--muted)"
          }`}
        >
          {message}
        </p>
      ) : null}
    </section>
  );
}

function getInjectedSolanaProvider() {
  if (typeof window === "undefined") {
    return null;
  }

  return window.phantom?.solana ?? window.solflare ?? window.solana ?? null;
}

function providerName(provider: InjectedSolanaProvider): ExternalWalletProvider {
  if (provider.isPhantom) {
    return "phantom";
  }

  if (provider.isSolflare) {
    return "solflare";
  }

  return "wallet_adapter";
}

function walletChain(): WalletChain {
  return process.env.NEXT_PUBLIC_SOLANA_CHAIN === "solana:mainnet" ? "solana_mainnet" : "solana_devnet";
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs uppercase text-(--muted)">{label}</p>
      <p className="mt-1 truncate font-medium">{value}</p>
    </div>
  );
}
