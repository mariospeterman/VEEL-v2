"use client";

import {
  useLoginWithEmail,
  useLoginWithOAuth,
  useLoginWithPasskey,
  usePrivy,
  useSignupWithPasskey
} from "@privy-io/react-auth";
import {
  useCreateWallet,
  useSignMessage as usePrivySolanaSignMessage,
  useWallets as usePrivySolanaWallets
} from "@privy-io/react-auth/solana";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ApiMutationError, getCurrentSession } from "@/api-mutations";
import { safeMutationMessage } from "@/api-errors";
import { ProviderLogo } from "@/brand/provider-logo";
import { recordOnboardingEvent } from "@/analytics/onboarding-analytics";
import { walletSessionDestination } from "@/supabase/access-redirect";
import { createBackendWalletSession, type WalletAuthPurpose } from "./backend-wallet-auth";
import {
  clearEmbeddedAuthResume,
  embeddedAuthMethods,
  rememberEmbeddedAuthResume,
  type EmbeddedAuthMethod
} from "./embedded-auth-method";
import { handleWalletAccountNotFound } from "./wallet-account-not-found";

export function EmbeddedWalletLoginMethods({
  initialMethod,
  onAccountNotFound,
  onLinked,
  purpose,
  secondary = false
}: {
  initialMethod: EmbeddedAuthMethod;
  purpose: WalletAuthPurpose;
  onAccountNotFound?: (() => void) | undefined;
  onLinked?: ((address: string) => void) | undefined;
  secondary?: boolean;
}) {
  const { authenticated, ready } = usePrivy();
  const { createWallet } = useCreateWallet();
  const { ready: walletsReady, wallets } = usePrivySolanaWallets();
  const { signMessage } = usePrivySolanaSignMessage();
  const [selectedMethod, setSelectedMethod] = useState<EmbeddedAuthMethod>(initialMethod);
  const [email, setEmail] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [emailCodeSent, setEmailCodeSent] = useState(false);
  const [flowRequested, setFlowRequested] = useState(false);
  const [walletProvisioned, setWalletProvisioned] = useState(false);
  const [state, setState] = useState<"idle" | "working" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const initialMethodStarted = useRef(false);
  const flowRunning = useRef(false);

  const accountNotFound = useCallback(() => {
    clearEmbeddedAuthResume();
    setFlowRequested(false);
    setState("working");
    setMessage("No WeVid account was found. Moving you to secure onboarding…");
    handleWalletAccountNotFound(onAccountNotFound);
  }, [onAccountNotFound]);

  const handlePrivyComplete = useCallback(() => {
    clearEmbeddedAuthResume();
    setState("working");
    setMessage("Verifying your noncustodial wallet…");
    setFlowRequested(true);
  }, []);

  const handlePrivyError = useCallback((error: unknown) => {
    clearEmbeddedAuthResume();
    if (purpose === "login" && error === "user_does_not_exist") {
      accountNotFound();
      return;
    }
    setFlowRequested(false);
    setState("error");
    setMessage(error === "exited_auth_flow" || error === "oauth_user_denied"
      ? "Sign-in was not completed. Choose a method when you are ready."
      : "Secure sign-in could not be completed. Check the provider configuration and try again.");
  }, [accountNotFound, purpose]);

  const privyCallbacks = {
    onComplete: handlePrivyComplete,
    onError: handlePrivyError
  };
  const { loginWithCode, sendCode } = useLoginWithEmail(privyCallbacks);
  const { initOAuth } = useLoginWithOAuth(privyCallbacks);
  const { loginWithPasskey } = useLoginWithPasskey(privyCallbacks);
  const { signupWithPasskey } = useSignupWithPasskey(privyCallbacks);

  useEffect(() => {
    if (!flowRequested || !authenticated || !ready || !walletsReady || flowRunning.current) return;

    flowRunning.current = true;
    void (async () => {
      try {
        const wallet = wallets.find((candidate) => candidate.standardWallet.name === "Privy");

        if (!wallet) {
          if (purpose === "login") {
            accountNotFound();
            return;
          }

          if (!walletProvisioned) {
            await createWallet();
            setWalletProvisioned(true);
            setMessage("Preparing your noncustodial wallet…");
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
        const appSession = await getCurrentSession();

        clearEmbeddedAuthResume();
        setFlowRequested(false);
        onLinked?.(wallet.address);
        if (!onLinked) redirectAfterEmbeddedWalletSession(appSession);
      } catch (error) {
        setFlowRequested(false);
        if (error instanceof ApiMutationError && error.status === 404 && purpose === "login") {
          accountNotFound();
          return;
        }
        setState("error");
        setMessage(safeMutationMessage(error, "Account sign-in"));
      } finally {
        flowRunning.current = false;
      }
    })();
  }, [accountNotFound, authenticated, createWallet, flowRequested, onLinked, purpose, ready, signMessage, walletProvisioned, wallets, walletsReady]);

  const startMethod = useCallback(async (method: EmbeddedAuthMethod) => {
    recordOnboardingEvent("auth_method_selected", `embedded-${method}-${purpose}`);
    setSelectedMethod(method);
    setMessage(null);
    setWalletProvisioned(false);

    if (!ready) {
      setState("error");
      setMessage("Secure sign-in is still loading. Try again in a moment.");
      return;
    }

    if (authenticated) {
      setState("working");
      setMessage("Verifying your noncustodial wallet…");
      setFlowRequested(true);
      return;
    }

    if (method === "email") {
      setState("idle");
      return;
    }

    setState("working");
    try {
      if (method === "passkey") {
        setFlowRequested(true);
        if (purpose === "login") await loginWithPasskey();
        else await signupWithPasskey();
        return;
      }

      rememberEmbeddedAuthResume(method, purpose);
      setFlowRequested(true);
      await initOAuth({ provider: method, disableSignup: purpose === "login" });
    } catch (error) {
      handlePrivyError(privyErrorCode(error));
    }
  }, [authenticated, handlePrivyError, initOAuth, loginWithPasskey, purpose, ready, signupWithPasskey]);

  useEffect(() => {
    if (initialMethodStarted.current || !ready) return;
    initialMethodStarted.current = true;
    void startMethod(initialMethod);
  }, [initialMethod, ready, startMethod]);

  async function requestEmailCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !normalizedEmail.includes("@")) {
      setState("error");
      setMessage("Enter a valid email address.");
      return;
    }

    setState("working");
    setMessage(null);
    try {
      await sendCode({ email: normalizedEmail, disableSignup: purpose === "login" });
      setEmailCodeSent(true);
      setState("idle");
      setMessage("Enter the one-time code sent to your email.");
    } catch (error) {
      handlePrivyError(privyErrorCode(error));
    }
  }

  async function verifyEmailCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!emailCode.trim()) {
      setState("error");
      setMessage("Enter the code from your email.");
      return;
    }

    setState("working");
    setMessage("Verifying your code…");
    setFlowRequested(true);
    try {
      await loginWithCode({ code: emailCode.trim() });
    } catch (error) {
      handlePrivyError(privyErrorCode(error, "invalid_credentials"));
    }
  }

  const busy = state === "working";

  return (
    <>
      {embeddedAuthMethods.map((method) => (
        <div className="auth-provider-button-stack" key={method.method}>
          <button
            aria-label={`${purpose === "login" ? "Continue" : "Set up"} with ${method.label}`}
            className={`auth-provider-button${secondary ? " auth-provider-button-secondary" : ""}${selectedMethod === method.method ? " auth-provider-button-active" : ""}`}
            disabled={busy}
            onClick={() => void startMethod(method.method)}
            type="button"
          >
            <ProviderLogo label={method.label} name={method.logo} />
            <span>
              <strong>{method.label}</strong>
              <small>{busy && selectedMethod === method.method ? "Working" : method.status}</small>
            </span>
          </button>
        </div>
      ))}
      {selectedMethod === "email" && !authenticated ? (
        emailCodeSent ? (
          <form className="auth-embedded-email" onSubmit={(event) => void verifyEmailCode(event)}>
            <label>
              One-time code
              <input autoComplete="one-time-code" inputMode="numeric" onChange={(event) => setEmailCode(event.target.value)} value={emailCode} />
            </label>
            <button disabled={busy} type="submit">Verify and continue</button>
          </form>
        ) : (
          <form className="auth-embedded-email" onSubmit={(event) => void requestEmailCode(event)}>
            <label>
              Email
              <input autoComplete="email" inputMode="email" onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" type="email" value={email} />
            </label>
            <button disabled={busy} type="submit">Send code</button>
          </form>
        )
      ) : null}
      {message ? <p className={`auth-provider-note auth-provider-note-${state === "error" ? "error" : "muted"}`}>{message}</p> : null}
    </>
  );
}

function redirectAfterEmbeddedWalletSession(session: Awaited<ReturnType<typeof getCurrentSession>>) {
  window.location.assign(walletSessionDestination("/app/home", session.appAccessState));
}

function privyErrorCode(error: unknown, fallback = "unknown_auth_error") {
  if (typeof error === "string") return error;
  if (!error || typeof error !== "object") return fallback;

  const candidate = error as { code?: unknown; privyErrorCode?: unknown };
  if (typeof candidate.privyErrorCode === "string") return candidate.privyErrorCode;
  if (typeof candidate.code === "string") return candidate.code;
  return fallback;
}
