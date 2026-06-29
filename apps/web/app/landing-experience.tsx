"use client";

import { Expand, ExternalLink, KeyRound, Languages, LogIn, MoreVertical, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { safeMutationMessage } from "@/api-errors";
import { createAgeSession } from "@/api-mutations";
import { createSupabaseBrowserClient } from "@/supabase/client";
import type { WebAuthState } from "@/supabase/auth-state";
import { EmbeddedWalletLoginButton } from "@/wallet/embedded-wallet-login";
import { WalletLinkPanel } from "@/wallet/wallet-link-panel";
import { WalletRuntimeProviders } from "@/wallet/wallet-runtime-providers";
import { legalDocLabels, legalDocSlugs, legalDocs, type LegalDocSlug } from "./legal-docs";

type OAuthProvider = "google" | "github" | "discord" | "twitter";

const supabaseActions: { label: string; provider: OAuthProvider }[] = [
  { label: "Google", provider: "google" },
  { label: "GitHub", provider: "github" },
  { label: "Discord", provider: "discord" },
  { label: "X", provider: "twitter" }
];

const onboardingSteps = [
  {
    eyebrow: "1 / 3",
    title: "Connect or create your wallet",
    copy: "Required. Use Solana Connect, or create an embedded non-custodial wallet with WeVid."
  },
  {
    eyebrow: "2 / 3",
    title: "Set up your profile",
    copy: "Optional. Add public details and recovery now, or set them up later in profile settings."
  },
  {
    eyebrow: "3 / 3",
    title: "Verify age for 18+ access",
    copy: "Required. Choose the least invasive path first. WeVid stores verification state, not raw documents."
  }
] as const;

const landingFrames = [
  {
    id: "welcome",
    label: "Welcome",
    kicker: "WeVid — Frame Your Way",
    title: "Create without asking the algorithm for permission.",
    copy:
      "A creator network for adults tired of censorship, ad dependency, privacy leaks, buried discovery, and payment systems that make direct support feel complicated.",
    primary: "Start onboarding",
    secondary: "Log in",
    visual: "intro"
  },
  {
    id: "watch-create",
    label: "Watch / Create",
    kicker: "Watch freely. Create verified.",
    title: "Watch freely. Create verified.",
    copy:
      "Viewers can discover and support. Verified creators can publish, unlock, go live, and build paid access.",
    primary: "Start onboarding",
    secondary: "Log in",
    visual: "access"
  },
  {
    id: "why-wevid",
    label: "Why WeVid",
    kicker: "Audience ownership",
    title: "Your audience should not belong to an ad network.",
    copy:
      "WeVid gives creators a verified, privacy-first space where access, payments, and community are not controlled by opaque ranking games.",
    primary: "Enter WeVid",
    secondary: "Log in",
    visual: "trust"
  },
  {
    id: "earn",
    label: "Earn",
    kicker: "Direct support",
    title: "Get paid without giving up control.",
    copy:
      "Tips, unlocks, memberships, and event access are tied to user-owned wallets and backend-verified access states. Fast, low-fee Solana settlement.",
    primary: "Start earning",
    secondary: "Log in",
    visual: "earn"
  },
  {
    id: "partners",
    label: "Partners",
    kicker: "Provider-ready",
    title: "Provider-ready. Not provider-owned.",
    copy:
      "Wallet, age, media, live, safety, and recovery providers plug into a WeVid trust layer without becoming the product.",
    primary: "Start onboarding",
    secondary: "Log in",
    visual: "partner"
  },
  {
    id: "trust",
    label: "Trust",
    kicker: "18+ by design",
    title: "18+ by design. Private by default.",
    copy:
      "Wallet readiness, profile state, and age verification unlock the app. Raw provider documents never become UI data.",
    primary: "Start onboarding",
    secondary: "Log in",
    visual: "trust"
  },
  {
    id: "onboarding",
    label: "Onboarding",
    kicker: "Enter WeVid",
    title: "Set up access.",
    copy: "Wallet and age proof are required. Profile and recovery can wait.",
    primary: "Continue setup",
    secondary: "Wallet login",
    visual: "start",
    auth: "onboard"
  },
  {
    id: "login",
    label: "Login",
    kicker: "Return",
    title: "Login to WeVid",
    copy: "Use wallet, embedded wallet, or Supabase recovery.",
    primary: "Wallet login",
    secondary: "Email recovery",
    visual: "login",
    auth: "login"
  }
] as const;

const storyNavFrames = landingFrames.filter((frame) => !("auth" in frame));

export function LandingExperience() {
  const shellRef = useRef<HTMLElement | null>(null);
  const copyRef = useRef<HTMLElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [legalDoc, setLegalDoc] = useState<LegalDocSlug | null>(null);
  const [legalExpanded, setLegalExpanded] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [initialOnboardingStep, setInitialOnboardingStep] = useState(0);
  const [authCallbackError, setAuthCallbackError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const activeFrame = landingFrames[activeIndex] ?? landingFrames[0];
  const activeAuth = "auth" in activeFrame ? activeFrame.auth : undefined;
  const publicAuthState = useMemo<WebAuthState>(
    () => ({ authenticated: false, configured: true, email: null }),
    []
  );

  const scrollToFrame = (index: number) => {
    const shell = shellRef.current;
    if (!shell) return;

    const boundedIndex = Math.min(landingFrames.length - 1, Math.max(0, index));
    const target = (shell.scrollHeight - shell.clientHeight) * (boundedIndex / (landingFrames.length - 1));
    shell.scrollTo({ behavior: "smooth", top: target });
  };

  useEffect(() => {
    document.documentElement.dataset.theme = "dark";

    const params = new URLSearchParams(window.location.search);
    const mode = params.get("mode");
    const step = params.get("step");
    const error = params.get("error");
    if (error === "auth_confirm_failed") {
      setAuthCallbackError("Login could not be completed. Check the provider redirect allowlist and try again.");
    } else if (error === "recovery_link_failed") {
      setAuthCallbackError("Recovery login worked, but it could not be linked to this wallet account. Start the API and try again.");
    }
    if (step === "profile") setInitialOnboardingStep(1);
    if (step === "age") setInitialOnboardingStep(2);
    const targetIndex =
      mode === "login"
        ? landingFrames.findIndex((frame) => frame.id === "login")
        : mode === "onboarding" || step
          ? landingFrames.findIndex((frame) => frame.id === "onboarding")
          : -1;

    if (targetIndex >= 0) {
      window.requestAnimationFrame(() => scrollToFrame(targetIndex));
      return;
    }

    window.requestAnimationFrame(() => {
      shellRef.current?.scrollTo({ top: 0 });
    });
  }, []);

  useEffect(() => {
    const shell = shellRef.current;

    if (!shell) {
      return;
    }

    let animationFrame = 0;
    const update = () => {
      animationFrame = 0;
      const maxScroll = Math.max(1, shell.scrollHeight - shell.clientHeight);
      const nextProgress = Math.min(1, Math.max(0, shell.scrollTop / maxScroll));
      const nextIndex = Math.min(
        landingFrames.length - 1,
        Math.max(0, Math.round(nextProgress * (landingFrames.length - 1)))
      );
      setProgress(nextProgress);
      setActiveIndex(nextIndex);

      const video = videoRef.current;
      if (video && Number.isFinite(video.duration) && video.duration > 0) {
        video.currentTime = Math.max(0, video.duration - 0.05) * nextProgress;
      }
    };

    const requestUpdate = () => {
      if (animationFrame) {
        return;
      }

      animationFrame = window.requestAnimationFrame(update);
    };

    update();
    shell.addEventListener("scroll", requestUpdate, { passive: true });

    return () => {
      shell.removeEventListener("scroll", requestUpdate);
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
    };
  }, []);

  useEffect(() => {
    if (!legalDoc) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setLegalDoc(null);
        setLegalExpanded(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [legalDoc]);

  useEffect(() => {
    let cancelled = false;

    async function animateCopy() {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        return;
      }

      const target = copyRef.current;
      if (!target) {
        return;
      }

      const { gsap } = await import("gsap");
      if (cancelled) {
        return;
      }

      gsap.fromTo(
        target.querySelectorAll("[data-story-part]"),
        {
          autoAlpha: 0,
          clipPath: "inset(0 0 34% 0)",
          y: 16
        },
        {
          autoAlpha: 1,
          clearProps: "opacity,visibility,clipPath,transform",
          clipPath: "inset(0 0 0% 0)",
          duration: 0.86,
          ease: "expo.out",
          stagger: 0.085,
          y: 0
        }
      );
    }

    void animateCopy();
    return () => {
      cancelled = true;
    };
  }, [activeIndex]);

  const cssVars = useMemo(
    () =>
      ({
        "--landing-progress": `${progress * 100}%`,
        "--landing-frame": activeIndex
      }) as CSSProperties,
    [activeIndex, progress]
  );

  return (
    <main className="landing-shell" ref={shellRef} style={cssVars}>
      <div className="landing-scroll-space" data-gsap-scope="landing-story-scroll">
        <section className="landing-viewport" aria-label="WeVid public landing">
          <video
            aria-hidden="true"
            className="landing-video"
            muted
            playsInline
            preload="metadata"
            ref={videoRef}
            src="/video/Veel.mp4"
          />
          <div className="landing-film-layer" data-visual={activeFrame.visual} aria-hidden="true" />

          <header className="landing-header">
            <a className="landing-logo-link" href="/" aria-label="WeVid home">
              <img alt="" className="landing-logo-image landing-logo-image-dark" src="/Logo-Light-Transparent.png" />
              <img alt="" className="landing-logo-image landing-logo-image-light" src="/Logo-Dark-Transparent.png" />
              <span>
                <strong>WeVid</strong>
                <small>FRAME YOUR WAY</small>
              </span>
            </a>

            <div className="landing-header-actions">
              <button
                aria-label="Log in"
                className="landing-icon-button"
                onClick={(event) => {
                  event.preventDefault();
                  scrollToFrame(landingFrames.findIndex((frame) => frame.id === "login"));
                }}
                title="Log in"
                type="button"
              >
                <KeyRound aria-hidden="true" size={18} />
              </button>
              <button
                aria-label="Start onboarding"
                className="landing-icon-button"
                onClick={(event) => {
                  event.preventDefault();
                  scrollToFrame(landingFrames.findIndex((frame) => frame.id === "onboarding"));
                }}
                title="Start onboarding"
                type="button"
              >
                <LogIn aria-hidden="true" size={18} />
              </button>
              <button
                aria-label="Language"
                className="landing-icon-button"
                title="Language"
                type="button"
              >
                <Languages aria-hidden="true" size={18} />
              </button>
            </div>
            <button
              aria-expanded={mobileMenuOpen}
              aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
              className="landing-mobile-menu-button"
              onClick={() => setMobileMenuOpen((value) => !value)}
              type="button"
            >
              {mobileMenuOpen ? <X aria-hidden="true" size={18} /> : <MoreVertical aria-hidden="true" size={20} />}
            </button>
          </header>

          <div className="landing-mobile-menu" data-open={mobileMenuOpen ? "true" : undefined}>
            <div className="landing-mobile-action-row" aria-label="Quick actions">
              <button
                aria-label="Log in"
                onClick={() => {
                  setMobileMenuOpen(false);
                  scrollToFrame(landingFrames.findIndex((frame) => frame.id === "login"));
                }}
                type="button"
              >
                <KeyRound aria-hidden="true" size={15} />
              </button>
              <button
                aria-label="Start onboarding"
                onClick={() => {
                  setMobileMenuOpen(false);
                  scrollToFrame(landingFrames.findIndex((frame) => frame.id === "onboarding"));
                }}
                type="button"
              >
                <LogIn aria-hidden="true" size={15} />
              </button>
              <button aria-label="Language" type="button">
                <Languages aria-hidden="true" size={15} />
              </button>
            </div>
            <div className="landing-mobile-nav-group" aria-label="Path navigation">
              <span>Path</span>
              {storyNavFrames.map((frame) => (
                <button
                  key={frame.id}
                  data-active={activeFrame.id === frame.id ? "true" : undefined}
                  onClick={() => {
                    setMobileMenuOpen(false);
                    scrollToFrame(landingFrames.findIndex((item) => item.id === frame.id));
                  }}
                  type="button"
                >
                  {frame.label}
                </button>
              ))}
            </div>
            <div className="landing-mobile-legal">
              <span>© 2026 WeVid</span>
              {legalDocSlugs.map((doc) => (
                <button
                  key={doc}
                  onClick={() => {
                    setMobileMenuOpen(false);
                    setLegalDoc(doc);
                  }}
                  type="button"
                >
                  {legalDocLabels[doc]}
                </button>
              ))}
            </div>
          </div>

          <section className={`landing-story ${activeAuth ? "landing-story-auth" : ""}`} id={activeFrame.id} ref={copyRef}>
            <p className="landing-eyebrow" data-story-part>{activeFrame.kicker}</p>
            <h1 data-story-part>{activeFrame.title}</h1>
            <p className="landing-copy" data-story-part>{activeFrame.copy}</p>
            {authCallbackError && activeFrame.id === "login" ? (
              <p className="landing-auth-error" data-story-part>{authCallbackError}</p>
            ) : null}
            {!activeAuth ? (
              <div className="landing-cta-row" data-story-part>
                <button
                  className="landing-button"
                  data-tone="primary"
                  onClick={() => scrollToFrame(landingFrames.findIndex((frame) => frame.id === "onboarding"))}
                  type="button"
                >
                  {activeFrame.primary}
                </button>
                <button
                  className="landing-button"
                  data-tone="ghost"
                  onClick={() => scrollToFrame(landingFrames.findIndex((frame) => frame.id === "login"))}
                  type="button"
                >
                  {activeFrame.secondary}
                </button>
              </div>
            ) : null}
            {activeAuth ? <LandingAuthSurface authState={publicAuthState} initialOnboardingStep={initialOnboardingStep} mode={activeAuth} /> : null}
          </section>

          <nav className="landing-progress-rail" aria-label="Landing story sections">
            <span className="landing-progress-percent">{Math.round(progress * 100).toString().padStart(2, "0")}%</span>
            <div className="landing-progress-track" aria-hidden="true">
              <i />
            </div>
            <span className="landing-progress-topic">{activeFrame.label}</span>
          </nav>

          <footer className="landing-legal-footer">
            <span>© 2026 WeVid</span>
            {legalDocSlugs.map((doc) => (
              <button key={doc} onClick={() => setLegalDoc(doc)} type="button">
                {legalDocLabels[doc]}
              </button>
            ))}
          </footer>

          {legalDoc ? (
            <div className="landing-modal-backdrop" role="presentation">
              <section
                aria-labelledby="landing-legal-title"
                aria-modal="true"
                className="landing-legal-modal"
                data-expanded={legalExpanded ? "true" : undefined}
                role="dialog"
              >
                <header>
                  <div>
                    <p>WeVid legal</p>
                    <h2 id="landing-legal-title">{legalDocLabels[legalDoc]}</h2>
                  </div>
                  <div className="landing-modal-actions">
                    <button aria-label={legalExpanded ? "Collapse legal modal" : "Expand legal modal"} onClick={() => setLegalExpanded((value) => !value)} type="button">
                      <Expand aria-hidden="true" size={18} />
                    </button>
                    <a aria-label={`Open ${legalDocLabels[legalDoc]} in new tab`} href={`/legal/${legalDoc}`} rel="noreferrer" target="_blank">
                      <ExternalLink aria-hidden="true" size={18} />
                    </a>
                    <button
                      aria-label="Close legal modal"
                      onClick={() => {
                        setLegalDoc(null);
                        setLegalExpanded(false);
                      }}
                      type="button"
                    >
                      <X aria-hidden="true" size={18} />
                    </button>
                  </div>
                </header>
                <p>{legalDocs[legalDoc]}</p>
              </section>
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}

function LandingAuthSurface({ authState, initialOnboardingStep, mode }: { authState: WebAuthState; initialOnboardingStep: number; mode: "login" | "onboard" }) {
  const [onboardingStep, setOnboardingStep] = useState(initialOnboardingStep);
  const currentStep = onboardingSteps[onboardingStep] ?? onboardingSteps[0]!;

  useEffect(() => {
    setOnboardingStep(initialOnboardingStep);
  }, [initialOnboardingStep]);

  return (
    <div
      className="landing-auth-inline"
      data-auth-mode={mode}
      data-story-part
    >
      {mode === "onboard" ? <LandingOnboardingStep authState={authState} currentStep={currentStep} onboardingStep={onboardingStep} setOnboardingStep={setOnboardingStep} /> : <LandingLoginForm authState={authState} />}
    </div>
  );
}

function LandingLoginForm({ authState }: { authState: WebAuthState }) {
  return (
    <>
      <div className="landing-auth-block">
        <p>Wallet</p>
        <span>Use Solana Connect.</span>
        <LandingWalletList authState={authState} />
      </div>
      <div className="landing-auth-block">
        <p>Recovery</p>
        <span>Use Supabase recovery already linked to your profile.</span>
        <LandingSupabaseAuth variant="login" />
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

  const advanceToAge = () => setOnboardingStep(2);

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
          Change or disconnect wallet
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
  const embeddedWalletRuntimeEnabled = process.env.NEXT_PUBLIC_EMBEDDED_WALLET_RUNTIME_ENABLED === "true";
  const privyConfigured = embeddedWalletRuntimeEnabled && Boolean(process.env.NEXT_PUBLIC_PRIVY_APP_ID);
  const turnkeyConfigured = embeddedWalletRuntimeEnabled && Boolean(process.env.NEXT_PUBLIC_TURNKEY_ORGANIZATION_ID);

  return (
    <WalletRuntimeProviders>
      <div className="landing-wallet-runtime" aria-label="Wallet providers">
        <div className="landing-wallet-connect-row">
          <WalletLinkPanel authState={authState} compact loginSimple onLinked={onLinked} reloadOnSession={!onLinked} />
        </div>
        <div className="landing-embedded-wallets" aria-label="Embedded wallet providers">
          <div className="landing-embedded-label">
            <p>Embedded wallet</p>
            <span>Use Privy or Turnkey when configured.</span>
          </div>
          <EmbeddedWalletLoginButton configured={privyConfigured} label="Privy" onLinked={onLinked} provider="privy" />
          <EmbeddedWalletLoginButton configured={turnkeyConfigured} label="Turnkey" onLinked={onLinked} provider="turnkey" />
        </div>
      </div>
    </WalletRuntimeProviders>
  );
}

function OnboardingProfileStep({ onContinue }: { onContinue: () => void }) {
  return (
    <div className="landing-profile-setup">
      <div className="landing-form-grid">
        <label className="landing-avatar-upload">
          <input name="profile-picture" type="file" />
          <span>Upload picture</span>
        </label>
        <label>
          <span>Handle</span>
          <input autoComplete="username" name="handle" placeholder="@wevid" type="text" />
        </label>
        <label>
          <span>Display name</span>
          <input autoComplete="name" name="name" placeholder="Display name" type="text" />
        </label>
        <label>
          <span>Link label</span>
          <input name="link-label" placeholder="Website" type="text" />
        </label>
        <label>
          <span>Link URL</span>
          <input name="links" placeholder="https://..." type="url" />
        </label>
        <label className="landing-form-wide">
          <span>Bio</span>
          <textarea name="bio" placeholder="Short creator bio" rows={3} />
        </label>
      </div>
      <div className="landing-step-actions">
        <button className="landing-button" data-tone="primary" onClick={onContinue} type="button">
          Save profile
        </button>
        <button className="landing-inline-link" onClick={onContinue} type="button">
          Skip profile. Set up later.
        </button>
      </div>
      <div className="landing-auth-block landing-recovery-auth">
        <p>Recovery auth</p>
        <LandingSupabaseAuth onSkip={onContinue} variant="profile" />
      </div>
    </div>
  );
}

function OnboardingAgeStep() {
  type AgeProviderPreference = "reusable_first" | "didit" | "yoti" | "sumsub" | "veriff" | "persona";
  type AgeProviderAction = {
    action: string;
    label: string;
    providerPreference: AgeProviderPreference;
  };
  const [startingProvider, setStartingProvider] = useState<AgeProviderPreference | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ageWaterfall: Array<{
    eyebrow: string;
    title: string;
    copy: string;
    providers: AgeProviderAction[];
  }> = [
    {
      eyebrow: "Recommended",
      title: "Reusable age ID",
      copy: "Reuse an existing age credential without uploading documents again.",
      providers: [
        { action: "Use", label: "Reusable age ID", providerPreference: "reusable_first" as const },
        { action: "Get", label: "Didit ID", providerPreference: "didit" as const },
        { action: "Get", label: "Yoti ID", providerPreference: "yoti" as const }
      ]
    },
    {
      eyebrow: "If needed",
      title: "Face age scan",
      copy: "Quick age estimate. No ID document if the provider supports it.",
      providers: [
        { action: "Check", label: "Persona", providerPreference: "persona" as const }
      ]
    },
    {
      eyebrow: "Fallback",
      title: "Trusted provider ID",
      copy: "Use document plus face verification when other paths are unavailable.",
      providers: [
        { action: "Verify", label: "Yoti", providerPreference: "yoti" as const },
        { action: "Verify", label: "Sumsub", providerPreference: "sumsub" as const },
        { action: "Verify", label: "Veriff", providerPreference: "veriff" as const },
        { action: "Verify", label: "Persona", providerPreference: "persona" as const }
      ]
    }
  ];

  async function startAgeSession(providerPreference: AgeProviderPreference) {
    setStartingProvider(providerPreference);
    setMessage(null);
    setError(null);

    try {
      const session = await createAgeSession({ providerPreference });
      setMessage(`Continue with ${session.provider}. WeVid only stores the signed result.`);
      window.location.assign(session.launchUrl);
    } catch (reason) {
      setError(safeMutationMessage(reason, "Age verification"));
    } finally {
      setStartingProvider(null);
    }
  }

  return (
    <div className="landing-age-waterfall" aria-label="Age verification providers">
      {ageWaterfall.map((tier) => (
        <div className="landing-age-tier" key={tier.title}>
          <div>
            <p>{tier.eyebrow}</p>
            <strong>{tier.title}</strong>
            <span>{tier.copy}</span>
          </div>
          <div className="landing-provider-row">
            {tier.providers.map((provider) => {
              const content = (
                <>
                  <span>{provider.label}</span>
                  <small>{provider.action}</small>
                </>
              );

              return (
                <button
                  className="landing-provider-link"
                  disabled={startingProvider === provider.providerPreference}
                  key={provider.label}
                  onClick={() => void startAgeSession(provider.providerPreference)}
                  type="button"
                >
                  {content}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <div className="landing-age-note">
        <span>Creator KYC/KYB is separate.</span>
        Viewer onboarding stores normalized age status only. Studio and enterprise checks remain separate before creator publishing, payouts, or business workflows.
      </div>
      {message ? <p className="landing-auth-message">{message}</p> : null}
      {error ? <p className="landing-auth-error">{error}</p> : null}
    </div>
  );
}

function LandingSupabaseAuth({ onSkip, variant }: { onSkip?: () => void; variant: "login" | "profile" }) {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState<"email" | OAuthProvider | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const supabase = useMemo(() => {
    try {
      return createSupabaseBrowserClient();
    } catch {
      return null;
    }
  }, []);
  const redirectTo = typeof window === "undefined" ? "" : `${window.location.origin}/auth/confirm?next=${encodeURIComponent("/app/home")}`;

  async function startEmailSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedEmail = email.trim();

    if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setError("Enter a valid email address.");
      return;
    }

    setSubmitting("email");
    setError(null);
    setMessage(null);

    if (!supabase) {
      setSubmitting(null);
      setError("Recovery auth is unavailable in this build.");
      return;
    }

    const { error: authError } = await supabase.auth.signInWithOtp({
      email: normalizedEmail,
      options: {
        emailRedirectTo: redirectTo,
        shouldCreateUser: variant === "profile"
      }
    });

    setSubmitting(null);

    if (authError) {
      setError(safeMutationMessage(authError, "Supabase email auth"));
      return;
    }

    setMessage(variant === "profile" ? "Check your email to continue recovery setup." : "Check your email for the login link.");
  }

  async function startOAuthSignIn(provider: OAuthProvider) {
    setSubmitting(provider);
    setError(null);
    setMessage(null);

    if (!supabase) {
      setSubmitting(null);
      setError("Recovery auth is unavailable in this build.");
      return;
    }

    const { error: authError } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo
      }
    });

    setSubmitting(null);

    if (authError) {
      setError(safeMutationMessage(authError, "Supabase social auth"));
    }
  }

  return (
    <div className="landing-supabase-auth">
      {supabase ? (
        <>
          <form className="landing-email-row" noValidate onSubmit={startEmailSignIn}>
            <label>
              <span>Email</span>
              <input
                autoComplete="email"
                inputMode="email"
                name={`${variant}-email`}
                onChange={(event) => {
                  setEmail(event.target.value);
                  if (error) setError(null);
                }}
                placeholder="you@example.com"
                type="email"
                value={email}
              />
            </label>
            <button className="landing-provider-link" disabled={submitting !== null} type="submit">
              <span>{submitting === "email" ? "Sending" : variant === "profile" ? "Email recovery" : "Send link"}</span>
            </button>
          </form>
          <div className="landing-provider-row" aria-label="Supabase social auth providers">
            {supabaseActions.map((provider) => (
              <button className="landing-provider-link" disabled={submitting !== null} key={provider.provider} onClick={() => void startOAuthSignIn(provider.provider)} type="button">
                <span>{submitting === provider.provider ? "Opening" : `Continue with ${provider.label}`}</span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <p className="landing-auth-unavailable">Recovery auth is unavailable in this build.</p>
      )}
      {onSkip ? (
        <button className="landing-inline-link" onClick={onSkip} type="button">
          Skip email. Add later.
        </button>
      ) : null}
      {message ? <p className="landing-auth-message">{message}</p> : null}
      {error ? <p className="landing-auth-message" data-error="true">{error}</p> : null}
    </div>
  );
}

function shortAddress(address: string) {
  return address.length > 10 ? `${address.slice(0, 4)}...${address.slice(-4)}` : address;
}
