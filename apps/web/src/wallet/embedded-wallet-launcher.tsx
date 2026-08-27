"use client";

import { useEffect, useRef, useState, type ComponentType } from "react";
import { ProviderLogo } from "@/brand/provider-logo";
import type { WalletAuthPurpose } from "./backend-wallet-auth";

interface EmbeddedWalletRuntimeProps {
  label: string;
  purpose: WalletAuthPurpose;
  onAccountNotFound?: (() => void) | undefined;
  onLinked?: ((address: string) => void) | undefined;
  secondary: boolean;
}

export function EmbeddedWalletLauncher({
  label,
  onAccountNotFound,
  onLinked,
  purpose,
  secondary = false
}: EmbeddedWalletRuntimeProps) {
  const [runtime, setRuntime] = useState<ComponentType<EmbeddedWalletRuntimeProps> | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const preloadedRuntime = useRef<ComponentType<EmbeddedWalletRuntimeProps> | null>(null);

  useEffect(() => {
    let active = true;
    void import("./embedded-wallet-login-runtime")
      .then((module) => {
        if (active) preloadedRuntime.current = module.EmbeddedWalletLoginRuntime;
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, []);

  async function start() {
    setState("loading");

    try {
      if (preloadedRuntime.current) {
        setRuntime(() => preloadedRuntime.current);
        return;
      }
      const module = await import("./embedded-wallet-login-runtime");
      setRuntime(() => module.EmbeddedWalletLoginRuntime);
    } catch {
      setState("error");
    }
  }

  if (runtime) {
    const Runtime = runtime;
    return <Runtime label={label} onAccountNotFound={onAccountNotFound} onLinked={onLinked} purpose={purpose} secondary={secondary} />;
  }

  return (
    <div className="auth-provider-button-stack">
      <button
        className={`auth-provider-button${secondary ? " auth-provider-button-secondary" : ""}`}
        disabled={state === "loading"}
        onClick={() => void start()}
        type="button"
      >
        <ProviderLogo label={label} name="privy" />
        <span>
          <strong>{label}</strong>
          <small>{state === "loading" ? "Opening" : purpose === "login" ? "Email · social · passkey" : "Secure embedded wallet"}</small>
        </span>
      </button>
      {state === "error" ? (
        <p className="auth-provider-note auth-provider-note-error">
          Secure wallet setup could not open. Try again.
        </p>
      ) : null}
    </div>
  );
}
