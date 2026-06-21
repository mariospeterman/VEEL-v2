"use client";

import { useCreateWallet, usePrivy, useLogin } from "@privy-io/react-auth";
import {
  useSignMessage as usePrivySolanaSignMessage,
  useWallets as usePrivySolanaWallets
} from "@privy-io/react-auth/solana";
import { useTurnkey, type WalletAccount } from "@turnkey/react-wallet-kit";
import bs58 from "bs58";
import { useState } from "react";
import { ApiMutationError } from "@/api-mutations";
import { safeMutationMessage } from "@/api-errors";
import { ProviderLogo } from "@/brand/provider-logo";
import { createBackendWalletSession } from "./backend-wallet-auth";

type EmbeddedProvider = "privy" | "turnkey";

export function EmbeddedWalletLoginButton({
  configured,
  label,
  onLinked,
  provider
}: {
  configured: boolean;
  label: string;
  onLinked?: ((address: string) => void) | undefined;
  provider: EmbeddedProvider;
}) {
  if (!configured) {
    return <DisabledEmbeddedProvider label={label} provider={provider} />;
  }

  if (provider === "privy") {
    return <PrivyEmbeddedLoginButton label={label} onLinked={onLinked} />;
  }

  return <TurnkeyEmbeddedLoginButton label={label} onLinked={onLinked} />;
}

function DisabledEmbeddedProvider({ label, provider }: { label: string; provider: EmbeddedProvider }) {
  const envName = provider === "privy" ? "NEXT_PUBLIC_PRIVY_APP_ID" : "NEXT_PUBLIC_TURNKEY_ORGANIZATION_ID";
  const shortMessage = provider === "privy" ? "Add Privy app ID." : "Add Turnkey org ID.";

  return (
    <div className="auth-provider-button-stack">
      <button
        className="auth-provider-button auth-provider-button-muted"
        aria-describedby={`embedded-${provider}-note`}
        type="button"
      >
        <ProviderLogo label={label} name={provider} />
        <span>
          <strong>{label}</strong>
          <small>Configure provider</small>
        </span>
      </button>
      <p className="auth-provider-note auth-provider-note-muted" id={`embedded-${provider}-note`} title={`Missing ${envName}.`}>
        {shortMessage}
      </p>
    </div>
  );
}

function PrivyEmbeddedLoginButton({ label, onLinked }: { label: string; onLinked?: ((address: string) => void) | undefined }) {
  const { authenticated, ready } = usePrivy();
  const { login } = useLogin();
  const { createWallet } = useCreateWallet();
  const { wallets } = usePrivySolanaWallets();
  const { signMessage } = usePrivySolanaSignMessage();
  const [state, setState] = useState<"idle" | "working" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function start() {
    setState("working");
    setMessage(null);

    try {
      if (!ready) {
        throw new ApiMutationError("Privy is still loading.");
      }

      if (!authenticated) {
        login();
        setState("idle");
        setMessage("Finish Privy login, then continue.");
        return;
      }

      const wallet = wallets[0];

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

function TurnkeyEmbeddedLoginButton({ label, onLinked }: { label: string; onLinked?: ((address: string) => void) | undefined }) {
  const { authState, handleLogin, refreshWallets, wallets } = useTurnkey();
  const [state, setState] = useState<"idle" | "working" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function start() {
    setState("working");
    setMessage(null);

    try {
      if (authState !== "authenticated") {
        await handleLogin({ title: "Enter WeVid" });
        setState("idle");
        setMessage("Finish Turnkey login, then continue.");
        return;
      }

      const latestWallets = await refreshWallets();
      const account = findTurnkeySolanaSigner(latestWallets.length > 0 ? latestWallets : wallets);

      if (!account) {
        throw new ApiMutationError("Turnkey did not expose a Solana signing account for this session.");
      }

      await createBackendWalletSession({
        address: account.address,
        provider: "embedded_turnkey",
        signMessage: async (challenge) => signatureStringToBytes(await account.signMessage(challenge))
      });

      onLinked?.(account.address);
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
      logo="turnkey"
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
  logo: EmbeddedProvider;
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

function findTurnkeySolanaSigner(wallets: Array<{ accounts: WalletAccount[] }>) {
  for (const wallet of wallets) {
    for (const account of wallet.accounts) {
      if (account.addressFormat === "ADDRESS_FORMAT_SOLANA" && hasSignMessage(account)) {
        return account;
      }
    }
  }

  return null;
}

function hasSignMessage(account: WalletAccount): account is WalletAccount & { signMessage: (message: string) => Promise<string> } {
  return typeof (account as { signMessage?: unknown }).signMessage === "function";
}

function signatureStringToBytes(signature: string) {
  if (/^[0-9a-f]+$/i.test(signature) && signature.length % 2 === 0) {
    return Uint8Array.from(signature.match(/.{1,2}/g)?.map((byte) => Number.parseInt(byte, 16)) ?? []);
  }

  try {
    const decoded = bs58.decode(signature);

    if (decoded.length === 64) {
      return decoded;
    }
  } catch {
    // Fall through to base64 decoding.
  }

  const binary = atob(signature);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
