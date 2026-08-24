"use client";

import { useCallback, useEffect, useState, type ComponentType, type FormEvent } from "react";
import { safeMutationMessage } from "@/api-errors";
import {
  ApiMutationError,
  createAgeSession,
  getCurrentSession,
  updateMyProfile,
  uploadMyProfileAvatar
} from "@/api-mutations";
import type { WebAuthState } from "@/supabase/auth-state";
import { ProviderLogo } from "@/brand/provider-logo";
import { SupabaseAuthPanel } from "@/supabase/supabase-auth-panel";
import type { WalletAuthPurpose } from "@/wallet/backend-wallet-auth";
import {
  consumeExpectedOnboardingJourneyExit,
  markOnboardingJourneyHandoff,
  recordOnboardingEvent
} from "@/analytics/onboarding-analytics";

type LandingWalletRuntimeProps = {
  autoStart?: boolean;
  authState: WebAuthState;
  purpose: WalletAuthPurpose;
  onAccountNotFound?: (() => void) | undefined;
  onLinked?: ((address: string) => void) | undefined;
};

const onboardingSteps = [
  {
    eyebrow: "1 / 3",
    title: "Wallet",
    copy: "Connect the wallet you use with WeVid."
  },
  {
    eyebrow: "2 / 3",
    title: "Profile details",
    copy: "Choose a handle. A name and photo are optional."
  },
  {
    eyebrow: "3 / 3",
    title: "Age verification",
    copy: "Confirm 18+ access."
  }
] as const;

export function LandingAuthSurface({
  authState,
  initialOnboardingStep,
  mode
}: {
  authState: WebAuthState;
  initialOnboardingStep: number;
  mode: "login" | "onboard";
}) {
  const [authMode, setAuthMode] = useState(mode);
  const [onboardingStep, setOnboardingStep] = useState(initialOnboardingStep);
  const currentStep = onboardingSteps[onboardingStep] ?? onboardingSteps[0]!;

  useEffect(() => {
    setAuthMode(mode);
    setOnboardingStep(initialOnboardingStep);
  }, [initialOnboardingStep, mode]);

  useEffect(() => {
    if (authMode !== "onboard") return;
    if (onboardingStep === 1) recordOnboardingEvent("profile_step_viewed");
    if (onboardingStep === 2) recordOnboardingEvent("age_step_started");
  }, [authMode, onboardingStep]);

  useEffect(() => {
    const recordAbandonment = () => {
      if (authMode === "onboard" && !consumeExpectedOnboardingJourneyExit()) {
        recordOnboardingEvent("onboarding_abandoned");
      }
    };
    window.addEventListener("pagehide", recordAbandonment);
    return () => window.removeEventListener("pagehide", recordAbandonment);
  }, [authMode]);

  return (
    <div className="landing-auth-inline" data-auth-mode={authMode} data-story-part>
      {authMode === "onboard" ? (
        <LandingOnboardingStep
          authState={authState}
          currentStep={currentStep}
          onboardingStep={onboardingStep}
          setOnboardingStep={setOnboardingStep}
        />
      ) : (
        <LandingLoginForm
          authState={authState}
          onAccountNotFound={() => {
            recordOnboardingEvent("account_not_found");
            setOnboardingStep(0);
            setAuthMode("onboard");
          }}
        />
      )}
    </div>
  );
}

function LandingLoginForm({ authState, onAccountNotFound }: { authState: WebAuthState; onAccountNotFound: () => void }) {
  return (
    <div className="landing-auth-block">
      <p className="landing-auth-method-title">Continue with your WeVid account</p>
      <LandingWalletList authState={authState} onAccountNotFound={onAccountNotFound} purpose="login" />
      <div className="landing-recovery-entry">
        <p>Use account recovery</p>
        <SupabaseAuthPanel mode="recovery" />
      </div>
    </div>
  );
}

function LandingOnboardingStep({
  authState,
  currentStep,
  onboardingStep,
  setOnboardingStep
}: {
  authState: WebAuthState;
  currentStep: (typeof onboardingSteps)[number];
  onboardingStep: number;
  setOnboardingStep: (step: number) => void;
}) {
  const [linkedWalletAddress, setLinkedWalletAddress] = useState<string | null>(null);
  const advanceToAge = useCallback(() => setOnboardingStep(2), [setOnboardingStep]);

  return (
    <>
      <div className="landing-step-copy">
        <p><span>{currentStep.eyebrow}</span> {currentStep.title}</p>
        <span>{currentStep.copy}</span>
        {linkedWalletAddress ? <small>Wallet connected: {shortAddress(linkedWalletAddress)}</small> : null}
      </div>
      {onboardingStep === 0 ? (
        <OnboardingWalletStep
          authState={authState}
          onLinked={(address) => {
            setLinkedWalletAddress(address);
            setOnboardingStep(1);
          }}
        />
      ) : null}
      {onboardingStep === 1 ? <OnboardingProfileStep onContinue={advanceToAge} /> : null}
      {onboardingStep === 2 ? <OnboardingAgeStep /> : null}
      {onboardingStep > 0 ? (
        <button className="landing-inline-link" onClick={() => setOnboardingStep(onboardingStep - 1)} type="button">
          Back
        </button>
      ) : null}
    </>
  );
}

function OnboardingWalletStep({ authState, onLinked }: { authState: WebAuthState; onLinked: (address: string) => void }) {
  return (
    <div className="landing-auth-block">
      <LandingWalletList authState={authState} onLinked={onLinked} purpose="onboarding" />
    </div>
  );
}

function LandingWalletList({ authState, onAccountNotFound, onLinked, purpose }: {
  authState: WebAuthState;
  onAccountNotFound?: (() => void) | undefined;
  onLinked?: ((address: string) => void) | undefined;
  purpose: WalletAuthPurpose;
}) {
  const [runtime, setRuntime] = useState<ComponentType<LandingWalletRuntimeProps> | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [runtimeAttempt, setRuntimeAttempt] = useState(0);
  const [autoStart, setAutoStart] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void import("./landing-wallet-runtime")
      .then((module) => {
        if (!cancelled) {
          setRuntime(() => module.LandingWalletRuntime);
          recordOnboardingEvent("wallet_runtime_ready");
        }
      })
      .catch(() => {
        if (!cancelled) setRuntimeError("Sign-in options could not load. Refresh and try again.");
      });

    return () => {
      cancelled = true;
    };
  }, [runtimeAttempt]);

  if (runtime) {
    const Runtime = runtime;
    return <Runtime authState={authState} autoStart={autoStart} onAccountNotFound={onAccountNotFound} onLinked={onLinked} purpose={purpose} />;
  }

  return (
    <div className="landing-wallet-runtime" aria-label="Sign-in options">
      {!runtimeError ? (
        <>
          <button
            aria-describedby="wallet-runtime-status"
            className="auth-provider-button"
            disabled={autoStart}
            onClick={() => {
              setAutoStart(true);
            }}
            type="button"
          >
            <ProviderLogo label={purpose === "login" ? "Use an existing wallet" : "Use an external wallet"} name="wallet" />
            <span><strong>{autoStart ? "Opening wallet" : purpose === "login" ? "Use an existing wallet" : "Use an external wallet"}</strong></span>
          </button>
          <p className="sr-only" id="wallet-runtime-status" role="status">
            {autoStart ? "Opening wallet connection" : "Wallet connection ready"}
          </p>
        </>
      ) : null}
      {runtimeError ? (
        <div className="landing-wallet-retry">
          <p className="landing-auth-error">{runtimeError}</p>
          <button className="auth-provider-button" onClick={() => {
            setRuntimeError(null);
            setRuntimeAttempt((attempt) => attempt + 1);
          }} type="button">Retry wallet connection</button>
        </div>
      ) : null}
    </div>
  );
}

function OnboardingProfileStep({ onContinue }: { onContinue: () => void }) {
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!avatarFile) {
      setAvatarPreview(null);
      return;
    }

    const nextPreview = URL.createObjectURL(avatarFile);
    setAvatarPreview(nextPreview);
    return () => URL.revokeObjectURL(nextPreview);
  }, [avatarFile]);

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const normalizedHandle = normalizeHandle(handle);
    const normalizedDisplayName = displayName.trim();

    if (!normalizedHandle || !/^[a-z0-9_]{2,32}$/.test(normalizedHandle)) {
      setError("Add a lowercase handle with 2-32 letters, numbers, or underscores.");
      return;
    }

    setSubmitting(true);

    try {
      const profilePayload = await buildProfilePayload({
        avatarFile,
        displayName: normalizedDisplayName,
        handle: normalizedHandle
      });
      await updateMyProfile(profilePayload);
      recordOnboardingEvent("profile_step_completed");
      await continueFromProfile();
    } catch (reason) {
      setError(reason instanceof Error && !(reason instanceof ApiMutationError) ? reason.message : safeMutationMessage(reason, "Profile setup"));
    } finally {
      setSubmitting(false);
    }
  }

  async function continueFromProfile() {
    const session = await getCurrentSession();
    const reason = session.appAccessState.reason;

    if (session.appAccessState.allowed) {
      recordOnboardingEvent("protected_app_entered");
      markOnboardingJourneyHandoff();
      window.location.assign("/app/home");
      return;
    }

    if (reason === "age_required" || reason === "age_pending") {
      onContinue();
      return;
    }

    if (reason === "identity_required") {
      setError("Choose a handle before entering WeVid.");
      return;
    }

    if (reason === "wallet_required") {
      setError("Reconnect your wallet before continuing.");
      return;
    }

    setError("Access is not ready yet. Try again in a moment.");
  }

  return (
    <>
      <form className="landing-profile-setup" noValidate onSubmit={saveProfile}>
        <div className="landing-form-grid">
          <label className="landing-avatar-upload">
            <input
              accept="image/jpeg,image/png,image/webp"
              name="profile-picture"
              onChange={(event) => {
                setAvatarFile(event.target.files?.[0] ?? null);
                setError(null);
              }}
              type="file"
            />
            {avatarPreview ? <img alt="" src={avatarPreview} /> : <span>Add photo</span>}
          </label>
          <label>
            <span>Handle</span>
            <input
              autoComplete="username"
              name="handle"
              onChange={(event) => setHandle(event.target.value)}
              placeholder="@wevid"
              type="text"
              value={handle}
            />
          </label>
          <label>
            <span>Display name</span>
            <input
              autoComplete="name"
              name="name"
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="Display name"
              type="text"
              value={displayName}
            />
          </label>
        </div>
        <div className="landing-step-actions">
          <button className="landing-button" data-tone="primary" disabled={submitting} type="submit">
            {submitting ? "Saving" : "Save and continue"}
          </button>
        </div>
      </form>
      {error ? <p className="landing-auth-error">{error}</p> : null}
    </>
  );
}

function OnboardingAgeStep() {
  const [startingAction, setStartingAction] = useState<"age" | "return" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [canContinue, setCanContinue] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("verification") !== "return") return;

    let cancelled = false;
    setStartingAction("return");
    setMessage("Confirming your verification...");

    async function waitForWebhook() {
      for (let attempt = 0; attempt < 12 && !cancelled; attempt += 1) {
        try {
          const session = await getCurrentSession();
          if (session.appAccessState.allowed) {
            recordOnboardingEvent("age_step_completed");
            recordOnboardingEvent("protected_app_entered");
            markOnboardingJourneyHandoff();
            window.location.assign(resolveSafeNextPath());
            return;
          }
        } catch {
          // Provider callbacks can arrive just before the signed webhook.
        }
        await new Promise((resolve) => window.setTimeout(resolve, 1_000));
      }

      if (!cancelled) {
        setStartingAction(null);
        setMessage(null);
        setError("Verification is still processing. Try again in a moment.");
        setCanContinue(true);
      }
    }

    void waitForWebhook();
    return () => {
      cancelled = true;
    };
  }, []);

  function ageErrorMessage(reason: unknown) {
    if (reason instanceof ApiMutationError && reason.status === 409) {
      if (reason.message.toLowerCase().includes("verified")) {
        setCanContinue(true);
        return "Age is already verified.";
      }

      return "Age check is already in progress. Try again or finish the open verification step.";
    }

    const message = safeMutationMessage(reason, "Age verification");
    return message.toLowerCase().includes("state changed") ? "Try again with a new age check." : message;
  }

  async function startAgeSession() {
    setStartingAction("age");
    setMessage(null);
    setError(null);
    setCanContinue(false);

    try {
      const session = await createAgeSession({ providerPreference: "reusable_first" });
      setMessage("Opening the secure age check. WeVid stores only the signed result.");
      markOnboardingJourneyHandoff();
      window.location.assign(session.launchUrl);
    } catch (reason) {
      recordOnboardingEvent("age_step_failed", Date.now().toString(36));
      const nextError = ageErrorMessage(reason);
      setError(nextError);

      if (reason instanceof ApiMutationError && reason.status === 409 && reason.message.toLowerCase().includes("verified")) {
        recordOnboardingEvent("age_step_completed");
        recordOnboardingEvent("protected_app_entered");
        markOnboardingJourneyHandoff();
        window.location.assign(resolveSafeNextPath());
      }
    } finally {
      setStartingAction(null);
    }
  }

  async function continueToWeVid() {
    setStartingAction("return");
    setError(null);
    setMessage(null);

    try {
      const session = await getCurrentSession();
      const reason = session.appAccessState.reason;

      if (session.appAccessState.allowed) {
        recordOnboardingEvent("age_step_completed");
        recordOnboardingEvent("protected_app_entered");
        markOnboardingJourneyHandoff();
        window.location.assign(resolveSafeNextPath());
        return;
      }

      if (reason === "identity_required") {
        markOnboardingJourneyHandoff();
        window.location.assign("/?mode=onboarding&step=profile&next=%2Fapp%2Fhome");
        return;
      }

      if (reason === "wallet_required") {
        markOnboardingJourneyHandoff();
        window.location.assign("/?mode=onboarding&step=wallet&next=%2Fapp%2Fhome");
        return;
      }

      if (reason === "age_required" || reason === "age_pending") {
        setError("Age status is not ready yet. Try another age check or refresh in a moment.");
        return;
      }

      setError("Access is not ready yet. Check your account status and try again.");
    } catch (reason) {
      setError(safeMutationMessage(reason, "App access"));
    } finally {
      setStartingAction(null);
    }
  }

  return (
    <div className="landing-age-waterfall" aria-label="Age verification">
      <div className="landing-age-choice-panel">
        <div className="landing-age-choice-copy">
          <p>18+ access</p>
          <strong>Confirm you are 18+.</strong>
          <span>We choose the lowest-friction approved method and only keep the result.</span>
        </div>
        <div className="landing-age-choice-actions">
          <button className="landing-button" data-tone="primary" disabled={startingAction !== null} onClick={() => void startAgeSession()} type="button">
            <strong>{startingAction === "age" ? "Opening age check" : "Verify age"}</strong>
          </button>
        </div>
      </div>
      {message ? <p className="landing-auth-message">{message}</p> : null}
      {error ? <p className="landing-auth-error">{error}</p> : null}
      {canContinue ? (
        <button className="landing-button landing-age-continue" disabled={startingAction !== null} onClick={() => void continueToWeVid()} type="button">
          Continue to WeVid
        </button>
      ) : null}
    </div>
  );
}

function shortAddress(address: string) {
  return address.length > 10 ? `${address.slice(0, 4)}...${address.slice(-4)}` : address;
}

function normalizeHandle(value: string) {
  return value.trim().replace(/^@+/, "").toLowerCase();
}

async function buildProfilePayload({
  avatarFile,
  displayName,
  handle
}: {
  avatarFile: File | null;
  displayName: string;
  handle: string;
}) {
  const avatarUrl = avatarFile ? await uploadAvatarFile(avatarFile) : null;

  return {
    ...(avatarUrl ? { avatarUrl } : {}),
    ...(displayName ? { displayName } : {}),
    handle
  };
}

async function uploadAvatarFile(file: File) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    throw new Error("Profile picture must be JPEG, PNG, or WebP.");
  }

  if (file.size > 5_000_000) {
    throw new Error("Profile picture must be 5MB or smaller.");
  }

  const dataBase64 = await fileToBase64(file);
  const contentType = file.type as "image/jpeg" | "image/png" | "image/webp";
  const uploaded = await uploadMyProfileAvatar({
    contentType,
    dataBase64,
    fileName: file.name
  });

  return uploaded.avatarUrl;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Profile picture could not be read."));
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const [, base64 = ""] = result.split(",");
      resolve(base64);
    };
    reader.readAsDataURL(file);
  });
}

function resolveSafeNextPath() {
  const params = new URLSearchParams(window.location.search);
  const next = params.get("next") ?? "/app/home";
  return next.startsWith("/") && !next.startsWith("//") ? next : "/app/home";
}
