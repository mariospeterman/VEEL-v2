"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { safeMutationMessage } from "@/api-errors";
import {
  ApiMutationError,
  createAgeSession,
  getCurrentSession,
  resumeAgeSession,
  type AgeSession,
  updateMyProfile
} from "@/api-mutations";
import type { WebAuthState } from "@/supabase/auth-state";
import { SupabaseAuthPanel } from "@/supabase/supabase-auth-panel";
import type { WalletAuthPurpose } from "@/wallet/backend-wallet-auth";
import { LandingWalletRuntime } from "./landing-wallet-runtime";
import {
  consumeExpectedOnboardingJourneyExit,
  markOnboardingJourneyHandoff,
  recordOnboardingEvent
} from "@/analytics/onboarding-analytics";
import { assignSameOriginPath } from "@/navigation/safe-same-origin-path";

const onboardingSteps = [
  {
    eyebrow: "1 / 3",
    title: "Wallet",
    copy: "Connect the wallet you use with WeVid."
  },
  {
    eyebrow: "2 / 3",
    title: "Profile details",
    copy: "Choose a handle. A display name is optional; you can continue without a photo."
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
            setOnboardingStep(0);
            setAuthMode("onboard");
          }}
        />
      )}
    </div>
  );
}

function LandingLoginForm({ authState, onAccountNotFound }: { authState: WebAuthState; onAccountNotFound: () => void }) {
  const [recoveryOpen, setRecoveryOpen] = useState(false);

  return (
    <div className="landing-auth-block">
      <p className="landing-auth-method-title">Choose how to continue</p>
      <LandingWalletList authState={authState} onAccountNotFound={onAccountNotFound} purpose="login" />
      <div className="landing-recovery-entry">
        <button
          aria-expanded={recoveryOpen}
          className="landing-inline-link landing-recovery-toggle"
          onClick={() => setRecoveryOpen((open) => !open)}
          type="button"
        >
          {recoveryOpen ? "Hide account recovery" : "Can't access your account?"}
        </button>
        {recoveryOpen ? (
          <div className="landing-recovery-panel">
            <p>Recovery can find an existing linked account. It never creates a new WeVid account.</p>
            <SupabaseAuthPanel mode="recovery" />
          </div>
        ) : null}
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
  return <LandingWalletRuntime authState={authState} onAccountNotFound={onAccountNotFound} onLinked={onLinked} purpose={purpose} />;
}

function OnboardingProfileStep({ onContinue }: { onContinue: () => void }) {
  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      const profilePayload = buildProfilePayload({
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
          <div aria-disabled="true" className="landing-avatar-upload">
            <span>Photo optional · available after setup</span>
          </div>
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
  const [ageSession, setAgeSession] = useState<AgeSession | null>(null);

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
            redirectToSafeNextPath();
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
      await presentOrResumeAgeSession(session, true);
    } catch (reason) {
      recordOnboardingEvent("age_step_failed", Date.now().toString(36));
      const nextError = ageErrorMessage(reason);
      setError(nextError);

      if (reason instanceof ApiMutationError && reason.status === 409 && reason.message.toLowerCase().includes("verified")) {
        recordOnboardingEvent("age_step_completed");
        recordOnboardingEvent("protected_app_entered");
        markOnboardingJourneyHandoff();
        redirectToSafeNextPath();
      }
    } finally {
      setStartingAction(null);
    }
  }

  async function presentOrResumeAgeSession(session: AgeSession, attemptResume: boolean) {
    let current = session;
    setAgeSession(current);

    if (!current.launchUrl && current.resumable && attemptResume) {
      setMessage("Checking the existing secure age-verification handoff...");
      current = await resumeAgeSession(current.id);
      setAgeSession(current);
    }

    if (!current.launchUrl) {
      setMessage(current.resumable
        ? "The secure provider handoff is still being reconciled. Resume this same session to check again."
        : "The provider outcome is still uncertain. We will not open a second session while this attempt is being reconciled.");
      return;
    }

    setMessage("Opening the secure age check. WeVid stores only the signed result.");
    markOnboardingJourneyHandoff();
    window.location.assign(current.launchUrl);
  }

  async function resumePendingAgeSession() {
    if (!ageSession) return;
    setStartingAction("age");
    setMessage(null);
    setError(null);
    try {
      await presentOrResumeAgeSession(ageSession, true);
    } catch (reason) {
      recordOnboardingEvent("age_step_failed", Date.now().toString(36));
      setError(ageErrorMessage(reason));
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
        redirectToSafeNextPath();
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
          {ageSession && !ageSession.launchUrl && ageSession.resumable ? (
            <button className="landing-button" disabled={startingAction !== null} onClick={() => void resumePendingAgeSession()} type="button">
              <strong>{startingAction === "age" ? "Checking secure handoff" : "Resume age check"}</strong>
            </button>
          ) : null}
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

function buildProfilePayload({
  displayName,
  handle
}: {
  displayName: string;
  handle: string;
}) {
  return {
    ...(displayName ? { displayName } : {}),
    handle
  };
}

function redirectToSafeNextPath() {
  const params = new URLSearchParams(window.location.search);
  assignSameOriginPath(params.get("next"), "/app/home");
}
