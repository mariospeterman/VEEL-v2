"use client";

import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { WalletReadyState } from "@solana/wallet-adapter-base";
import { useWallet, type Wallet } from "@solana/wallet-adapter-react";
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
type MessageSigner = {
  signMessage(message: Uint8Array): Promise<Uint8Array>;
};
type InjectedSolanaProvider = {
  isBackpack?: boolean;
  isPhantom?: boolean;
  isSolflare?: boolean;
  signMessage?: (message: Uint8Array, display?: "utf8" | "hex") => Promise<Uint8Array | { signature: Uint8Array }>;
  solana?: InjectedSolanaProvider;
};

type WalletOption = {
  key: "solana";
  label: string;
  logo: "wallet";
  provider: ExternalWalletProvider;
};

const walletOptions: WalletOption[] = [
  { key: "solana", label: "Connect wallet", logo: "wallet", provider: "wallet_adapter" }
];

interface WalletLinkPanelProps {
  authState: WebAuthState;
  compact?: boolean;
  loginSimple?: boolean;
  onLinked?: ((address: string) => void) | undefined;
  reloadOnSession?: boolean;
}

export function WalletLinkPanel({ authState, compact = false, loginSimple = false, onLinked, reloadOnSession = true }: WalletLinkPanelProps) {
  const { wallets } = useWallet();
  const [mounted, setMounted] = useState(false);
  const [chooserOpen, setChooserOpen] = useState(false);
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

  const selectableWallets = useMemo(
    () => wallets.filter((wallet) => wallet.readyState !== WalletReadyState.Unsupported),
    [wallets]
  );

  async function linkWalletAdapter(option?: WalletOption, selectedWallet?: Wallet) {
    setState("linking");
    setMessage(null);

    try {
      const wallet = selectedWallet ?? (option ? findWalletForOption(wallets, option) : findFirstReadyWallet(wallets));
      const walletProvider = providerForWallet(wallet);

      if (!wallet) {
        throw new ApiMutationError("Install or unlock a supported Solana wallet, then try again.");
      }

      if (wallet.readyState === WalletReadyState.Unsupported) {
        throw new ApiMutationError(`${wallet.adapter.name} is not supported in this browser.`);
      }

      if (!wallet.adapter.connected) {
        await wallet.adapter.connect();
      }

      const messageSigner = getMessageSigner(wallet) ?? getInjectedMessageSigner();

      if (!messageSigner) {
        throw new ApiMutationError(`${wallet.adapter.name} is connected but did not expose message signing.`);
      }

      const address = wallet.adapter.publicKey?.toString();

      if (!address) {
        throw new ApiMutationError("Wallet did not return a public address.");
      }

      const chain = walletChain();

      if (!authState.authenticated || authState.method === "wallet") {
        await createBackendWalletSession({
          address,
          provider: walletProvider,
          signMessage: (message) => messageSigner.signMessage(new TextEncoder().encode(message))
        });

        setLinkedAddress(address);
        setState("linked");
        setMessage("Wallet session created. Continue with profile and age verification.");
        setChooserOpen(false);
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
      const signature = await messageSigner.signMessage(new TextEncoder().encode(challenge.message));

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
      setChooserOpen(false);
      setMessage("Wallet linked. Access still depends on backend age and policy state.");
      onLinked?.(address);
    } catch (error) {
      setState("error");
      setMessage(safeMutationMessage(error, "Wallet connection"));
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
          {walletOptions.map((wallet) => (
            <span key={wallet.label}>
              <ProviderLogo label={wallet.label} name={wallet.logo} />
              <span>{wallet.label}</span>
            </span>
          ))}
        </div>
      )}

      {loginSimple ? (
        <>
          <div className="auth-provider-button-grid auth-provider-button-grid-wallets" aria-label="Wallet login providers">
            <button
              className="auth-provider-button"
              disabled={state === "linking"}
              onClick={() => setChooserOpen(true)}
              type="button"
            >
              <ProviderLogo label="Connect wallet" name="wallet" />
              <span>
                <strong>Connect wallet</strong>
                <small>{state === "linking" ? "Waiting" : "Choose wallet"}</small>
              </span>
            </button>
          </div>
          {chooserOpen ? (
            <div className="auth-wallet-choice-backdrop" role="presentation">
              <section aria-label="Choose wallet" aria-modal="true" className="auth-wallet-choice-modal" role="dialog">
                <header>
                  <div>
                    <p>Solana wallet</p>
                    <h3>Choose wallet</h3>
                  </div>
                  <button aria-label="Close wallet chooser" onClick={() => setChooserOpen(false)} type="button">
                    <X aria-hidden="true" size={17} />
                  </button>
                </header>
                <div className="auth-wallet-choice-list">
                  {!mounted ? <p>Detecting wallets...</p> : null}
                  {mounted && selectableWallets.length === 0 ? (
                    <p>Install or open a Solana wallet with browser signing support.</p>
                  ) : null}
                  {selectableWallets.map((wallet) => (
                    <button
                      disabled={state === "linking" || wallet.readyState === WalletReadyState.Unsupported}
                      key={wallet.adapter.name}
                      onClick={() => void linkWalletAdapter(undefined, wallet)}
                      type="button"
                    >
                      <span>{wallet.adapter.name}</span>
                      <small>{wallet.readyState === WalletReadyState.Installed ? "Installed" : wallet.readyState}</small>
                    </button>
                  ))}
                </div>
              </section>
            </div>
          ) : null}
        </>
      ) : (
        <button
          className="auth-wallet-primary-button"
          disabled={state === "linking"}
          onClick={() => void linkWalletAdapter()}
          type="button"
        >
          <span>{state === "linking" ? "Waiting for wallet" : authState.method === "supabase" ? "Connect and link" : "Connect wallet"}</span>
        </button>
      )}

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

function findWalletForOption(wallets: Wallet[], option: WalletOption) {
  return option.key === "solana" ? findFirstReadyWallet(wallets) : null;
}

function findFirstReadyWallet(wallets: Wallet[]) {
  return (
    wallets.find((wallet) => wallet.readyState === WalletReadyState.Installed && getMessageSigner(wallet)) ??
    wallets.find((wallet) => wallet.readyState === WalletReadyState.Loadable && getMessageSigner(wallet)) ??
    null
  );
}

function getMessageSigner(wallet: Wallet): MessageSigner | null {
  const adapter = wallet.adapter as typeof wallet.adapter & Partial<MessageSigner>;

  return typeof adapter.signMessage === "function" ? { signMessage: adapter.signMessage.bind(adapter) } : null;
}

function getInjectedMessageSigner(): MessageSigner | null {
  const provider = findInjectedProvider();

  if (!provider?.signMessage) {
    return null;
  }

  return {
    signMessage: async (message) => normalizeInjectedSignature(await provider.signMessage?.(message, "utf8"))
  };
}

function findInjectedProvider(): InjectedSolanaProvider | null {
  if (typeof window === "undefined") {
    return null;
  }

  const win = window as typeof window & {
    backpack?: InjectedSolanaProvider;
    phantom?: InjectedSolanaProvider;
    solana?: InjectedSolanaProvider;
    solflare?: InjectedSolanaProvider;
  };

  return win.solana ?? null;
}

function normalizeInjectedSignature(value: Uint8Array | { signature: Uint8Array } | undefined) {
  if (value instanceof Uint8Array) {
    return value;
  }

  if (value?.signature instanceof Uint8Array) {
    return value.signature;
  }

  throw new ApiMutationError("Wallet returned an unsupported message signature.");
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

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs uppercase text-(--muted)">{label}</p>
      <p className="mt-1 truncate font-medium">{value}</p>
    </div>
  );
}
