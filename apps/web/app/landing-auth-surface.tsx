"use client";

import { Plus, Trash2 } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useState, type ComponentType, type FormEvent } from "react";
import { safeMutationMessage } from "@/api-errors";
import {
  ApiMutationError,
  createAgeSession,
  createStarterProfile,
  getCurrentSession,
  updateMyProfile,
  uploadMyProfileAvatar
} from "@/api-mutations";
import { ProviderLogo } from "@/brand/provider-logo";
import { ageProviderActions, type AgeProviderPreference, embeddedWalletProviderConfig } from "@/providers/onboarding-provider-config";
import { readPublicWebEnv } from "@/public-env";
import type { WebAuthState } from "@/supabase/auth-state";

const SupabaseAuthPanel = dynamic(
  () => import("@/supabase/supabase-auth-panel").then((mod) => mod.SupabaseAuthPanel),
  { ssr: false }
);

type LandingWalletRuntimeProps = {
  authState: WebAuthState;
  onLinked?: ((address: string) => void) | undefined;
};

type ProfileLinkDraft = {
  id: string;
  label: string;
  url: string;
};

const onboardingSteps = [
  {
    eyebrow: "1 / 3",
    title: "Connect wallet",
    copy: "Choose the wallet you want to use with WeVid."
  },
  {
    eyebrow: "2 / 3",
    title: "Profile details",
    copy: "Add public details now, or create a starter profile and edit it later."
  },
  {
    eyebrow: "3 / 3",
    title: "Age verification",
    copy: "Verify 18+ access with a reusable provider when possible."
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
  const [onboardingStep, setOnboardingStep] = useState(initialOnboardingStep);
  const currentStep = onboardingSteps[onboardingStep] ?? onboardingSteps[0]!;

  useEffect(() => {
    setOnboardingStep(initialOnboardingStep);
  }, [initialOnboardingStep]);

  return (
    <div className="landing-auth-inline" data-auth-mode={mode} data-story-part>
      {mode === "onboard" ? (
        <LandingOnboardingStep
          authState={authState}
          currentStep={currentStep}
          onboardingStep={onboardingStep}
          setOnboardingStep={setOnboardingStep}
        />
      ) : (
        <LandingLoginForm authState={authState} />
      )}
    </div>
  );
}

function LandingLoginForm({ authState }: { authState: WebAuthState }) {
  return (
    <>
      <div className="landing-auth-block">
        <p>Wallet login</p>
        <span>Choose a Solana wallet and sign once.</span>
        <LandingWalletList authState={authState} />
      </div>
      <div className="landing-auth-block">
        <p>Supabase auth</p>
        <span>Email or social login for an account that already added Supabase auth.</span>
        <SupabaseAuthPanel mode="login" />
      </div>
    </>
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
      <LandingWalletList authState={authState} onLinked={onLinked} />
    </div>
  );
}

function LandingWalletList({ authState, onLinked }: { authState: WebAuthState; onLinked?: (address: string) => void }) {
  const embeddedWallets = embeddedWalletProviderConfig(readPublicWebEnv());
  const [runtime, setRuntime] = useState<ComponentType<LandingWalletRuntimeProps> | null>(null);
  const [loadingRuntime, setLoadingRuntime] = useState(false);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);

  async function loadWalletRuntime() {
    if (runtime || loadingRuntime) return;

    setRuntimeError(null);
    setLoadingRuntime(true);
    try {
      const module = await import("./landing-wallet-runtime");
      setRuntime(() => module.LandingWalletRuntime);
    } catch {
      setRuntimeError("Wallet providers could not load. Refresh and try again.");
    } finally {
      setLoadingRuntime(false);
    }
  }

  if (runtime) {
    const Runtime = runtime;
    return <Runtime authState={authState} onLinked={onLinked} />;
  }

  return (
    <div className="landing-wallet-runtime" aria-label="Wallet providers" data-embedded={embeddedWallets.enabled ? "true" : "false"}>
      <p className="landing-wallet-required">Required. Load wallet providers only when you are ready to connect and sign.</p>
      <div className="landing-wallet-connect-row">
        <button
          aria-busy={loadingRuntime ? "true" : undefined}
          className="landing-button"
          data-tone="primary"
          disabled={loadingRuntime}
          onClick={() => void loadWalletRuntime()}
          type="button"
        >
          <strong>{loadingRuntime ? "Loading wallet providers" : "Connect wallet"}</strong>
          <small>Solana ownership signature only</small>
        </button>
      </div>
      <div className="landing-embedded-wallets" aria-label="Embedded wallet providers">
        <div className="landing-embedded-label">
          <p>Embedded wallet</p>
          <span>{embeddedWallets.enabled ? "Available after wallet providers load." : "Provider login is waiting for runtime configuration."}</span>
        </div>
        {embeddedWallets.providers.map((provider) => (
          <button
            className="landing-provider-disabled"
            disabled={!provider.configured || loadingRuntime}
            key={provider.provider}
            onClick={provider.configured ? () => void loadWalletRuntime() : undefined}
            type="button"
          >
            <strong>{provider.label}</strong>
            <small>{provider.configured ? "Load provider" : "Not configured"}</small>
          </button>
        ))}
      </div>
      {runtimeError ? <p className="landing-auth-error">{runtimeError}</p> : null}
    </div>
  );
}

function OnboardingProfileStep({ onContinue }: { onContinue: () => void }) {
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [links, setLinks] = useState<ProfileLinkDraft[]>([]);
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

  function updateLink(id: string, patch: Partial<Omit<ProfileLinkDraft, "id">>) {
    setLinks((current) => current.map((link) => (link.id === id ? { ...link, ...patch } : link)));
  }

  function addLink() {
    setLinks((current) =>
      current.length >= 3
        ? current
        : [...current, { id: crypto.randomUUID(), label: "", url: "" }]
    );
  }

  function removeLink(id: string) {
    setLinks((current) => current.filter((link) => link.id !== id));
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const normalizedHandle = normalizeHandle(handle);
    const normalizedDisplayName = displayName.trim();

    if (!normalizedHandle || !/^[a-zA-Z0-9_]{2,32}$/.test(normalizedHandle)) {
      setError("Add a handle with 2-32 letters, numbers, or underscores.");
      return;
    }

    if (!normalizedDisplayName) {
      setError("Add a display name or use the starter profile.");
      return;
    }

    const normalizedLinks = normalizeProfileLinks(links);
    if (normalizedLinks instanceof Error) {
      setError(normalizedLinks.message);
      return;
    }

    setSubmitting(true);

    try {
      const profilePayload = await buildProfilePayload({
        avatarFile,
        bio,
        displayName: normalizedDisplayName,
        handle: normalizedHandle,
        links: normalizedLinks
      });
      await updateMyProfile(profilePayload);
      await continueFromProfile();
    } catch (reason) {
      setError(reason instanceof Error && !(reason instanceof ApiMutationError) ? reason.message : safeMutationMessage(reason, "Profile setup"));
    } finally {
      setSubmitting(false);
    }
  }

  async function createStarter() {
    setError(null);
    setSubmitting(true);

    try {
      await createStarterProfile();
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
      window.location.assign("/app/home");
      return;
    }

    if (reason === "age_required" || reason === "age_pending") {
      onContinue();
      return;
    }

    if (reason === "identity_required") {
      setError("Handle and display name are required before entering WeVid.");
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
          <label className="landing-form-wide">
            <span>Bio</span>
            <textarea
              name="bio"
              onChange={(event) => setBio(event.target.value)}
              placeholder="Short creator bio"
              rows={3}
              value={bio}
            />
          </label>
        </div>
        <div className="landing-profile-links" aria-label="Profile links">
          <div className="landing-profile-links-header">
            <p>Links</p>
            <button aria-label="Add profile link" disabled={links.length >= 3} onClick={addLink} type="button">
              <Plus aria-hidden="true" size={14} />
            </button>
          </div>
          {links.length > 0 ? (
            <div className="landing-profile-link-list">
              {links.map((link, index) => (
                <div className="landing-profile-link-row" key={link.id}>
                  <input
                    aria-label={`Link ${index + 1} label`}
                    onChange={(event) => updateLink(link.id, { label: event.target.value })}
                    placeholder="Website"
                    type="text"
                    value={link.label}
                  />
                  <input
                    aria-label={`Link ${index + 1} URL`}
                    inputMode="url"
                    onChange={(event) => updateLink(link.id, { url: event.target.value })}
                    placeholder="https://..."
                    type="url"
                    value={link.url}
                  />
                  <button
                    aria-label={`Remove link ${index + 1}`}
                    onClick={() => removeLink(link.id)}
                    type="button"
                  >
                    <Trash2 aria-hidden="true" size={14} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="landing-profile-empty">Add links later or use + for up to 3 now.</p>
          )}
        </div>
        <div className="landing-step-actions">
          <button className="landing-button" data-tone="primary" disabled={submitting} type="submit">
            {submitting ? "Saving" : "Save and continue"}
          </button>
          <button className="landing-inline-link" disabled={submitting} onClick={() => void createStarter()} type="button">
            Create starter profile
          </button>
        </div>
      </form>
      <details className="landing-auth-block landing-supabase-auth-toggle">
        <summary>
          <span>Supabase auth</span>
          <small>Optional email or social login</small>
        </summary>
        <SupabaseAuthPanel mode="profile" next="/?mode=onboarding&step=profile" />
      </details>
      {error ? <p className="landing-auth-error">{error}</p> : null}
    </>
  );
}

function OnboardingAgeStep() {
  const [startingProvider, setStartingProvider] = useState<AgeProviderPreference | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [canContinue, setCanContinue] = useState(false);

  function ageErrorMessage(reason: unknown) {
    if (reason instanceof ApiMutationError && reason.status === 409) {
      if (reason.message.toLowerCase().includes("verified")) {
        setCanContinue(true);
        return "Age is already verified.";
      }

      return "Age check is already in progress. Try again or finish the provider flow.";
    }

    const message = safeMutationMessage(reason, "Age verification");
    return message.toLowerCase().includes("state changed") ? "Try again with a new age check." : message;
  }

  async function startAgeSession(providerPreference: AgeProviderPreference) {
    setStartingProvider(providerPreference);
    setMessage(null);
    setError(null);
    setCanContinue(false);

    try {
      const session = await createAgeSession({ providerPreference });
      setMessage(`Continue with ${session.provider}. WeVid only stores the signed result.`);
      window.location.assign(session.launchUrl);
    } catch (reason) {
      const nextError = ageErrorMessage(reason);
      setError(nextError);

      if (reason instanceof ApiMutationError && reason.status === 409 && reason.message.toLowerCase().includes("verified")) {
        window.location.assign(resolveSafeNextPath());
      }
    } finally {
      setStartingProvider(null);
    }
  }

  async function continueToWeVid() {
    setStartingProvider("reusable_first");
    setError(null);
    setMessage(null);

    try {
      const session = await getCurrentSession();
      const reason = session.appAccessState.reason;

      if (session.appAccessState.allowed) {
        window.location.assign(resolveSafeNextPath());
        return;
      }

      if (reason === "identity_required") {
        window.location.assign("/?mode=onboarding&step=profile&next=%2Fapp%2Fhome");
        return;
      }

      if (reason === "wallet_required") {
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
      setStartingProvider(null);
    }
  }

  return (
    <div className="landing-age-waterfall" aria-label="Age verification providers">
      <div className="landing-age-choice-panel">
        <div className="landing-age-choice-copy">
          <p>18+ access</p>
          <strong>Choose age proof.</strong>
          <span>Reusable proof first. Document or face checks are fallback paths.</span>
        </div>
        <div className="landing-age-choice-actions">
          {ageProviderActions.map((provider, index) => (
            <button
              className="landing-provider-link"
              data-primary={index === 0 ? "true" : undefined}
              disabled={startingProvider === provider.providerPreference}
              key={provider.label}
              onClick={() => void startAgeSession(provider.providerPreference)}
              type="button"
            >
              <ProviderLogo label={provider.label} name={provider.logo} />
              <span>{provider.label}</span>
              <small>{startingProvider === provider.providerPreference ? "Opening" : provider.action}</small>
            </button>
          ))}
        </div>
      </div>
      {message ? <p className="landing-auth-message">{message}</p> : null}
      {error ? <p className="landing-auth-error">{error}</p> : null}
      {canContinue ? (
        <button className="landing-button landing-age-continue" disabled={startingProvider !== null} onClick={() => void continueToWeVid()} type="button">
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
  return value.trim().replace(/^@+/, "");
}

function normalizeProfileLinks(links: ProfileLinkDraft[]) {
  const normalized = links
    .map((link) => ({
      label: link.label.trim(),
      url: link.url.trim()
    }))
    .filter((link) => link.label || link.url);

  for (const link of normalized) {
    if (!link.label || !link.url) {
      return new Error("Complete both label and URL for each link, or remove the row.");
    }

    if (!link.url.startsWith("https://")) {
      return new Error("Profile links must start with https://");
    }
  }

  return normalized;
}

async function buildProfilePayload({
  avatarFile,
  bio,
  displayName,
  handle,
  links
}: {
  avatarFile: File | null;
  bio: string;
  displayName: string;
  handle: string;
  links: Array<{ label: string; url: string }>;
}) {
  const avatarUrl = avatarFile ? await uploadAvatarFile(avatarFile) : null;

  return {
    ...(avatarUrl ? { avatarUrl } : {}),
    ...(bio.trim() ? { bio: bio.trim() } : {}),
    displayName,
    handle,
    links
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
