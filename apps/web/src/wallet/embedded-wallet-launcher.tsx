"use client";

import { useEffect, useRef, useState, type ComponentType } from "react";
import { ProviderLogo } from "@/brand/provider-logo";
import type { WalletAuthPurpose } from "./backend-wallet-auth";
import { embeddedAuthMethods, readEmbeddedAuthResume, type EmbeddedAuthMethod } from "./embedded-auth-method";

interface EmbeddedWalletRuntimeProps {
  purpose: WalletAuthPurpose;
  onAccountNotFound?: (() => void) | undefined;
  onLinked?: ((address: string) => void) | undefined;
  secondary: boolean;
  initialMethod: EmbeddedAuthMethod;
}

export function EmbeddedWalletLauncher({
  onAccountNotFound,
  onLinked,
  purpose,
  secondary = false
}: Omit<EmbeddedWalletRuntimeProps, "initialMethod"> & { label: string }) {
  const [runtime, setRuntime] = useState<ComponentType<EmbeddedWalletRuntimeProps> | null>(null);
  const [selectedMethod, setSelectedMethod] = useState<EmbeddedAuthMethod | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const resumeStarted = useRef(false);

  useEffect(() => {
    if (resumeStarted.current) return;
    const resumedMethod = readEmbeddedAuthResume(purpose);
    if (!resumedMethod) return;
    resumeStarted.current = true;
    void start(resumedMethod);
  }, [purpose]);

  async function start(method: EmbeddedAuthMethod) {
    resumeStarted.current = true;
    setSelectedMethod(method);
    setState("loading");

    try {
      const module = await import("./embedded-wallet-login-runtime");
      setRuntime(() => module.EmbeddedWalletLoginRuntime);
    } catch {
      setState("error");
    }
  }

  if (runtime) {
    const Runtime = runtime;
    return selectedMethod ? (
      <Runtime
        initialMethod={selectedMethod}
        onAccountNotFound={onAccountNotFound}
        onLinked={onLinked}
        purpose={purpose}
        secondary={secondary}
      />
    ) : null;
  }

  return embeddedAuthMethods.map((method) => (
    <div className="auth-provider-button-stack" key={method.method}>
      <button
        aria-label={`${purpose === "login" ? "Continue" : "Set up"} with ${method.label}`}
        className={`auth-provider-button${secondary ? " auth-provider-button-secondary" : ""}`}
        disabled={state === "loading"}
        onClick={() => void start(method.method)}
        type="button"
      >
        <ProviderLogo label={method.label} name={method.logo} />
        <span>
          <strong>{method.label}</strong>
          <small>{state === "loading" && selectedMethod === method.method ? "Loading secure sign-in" : method.status}</small>
        </span>
      </button>
      {state === "error" && selectedMethod === method.method ? (
        <p className="auth-provider-note auth-provider-note-error">Secure sign-in could not load. Try again.</p>
      ) : null}
    </div>
  ));
}
