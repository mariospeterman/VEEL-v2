"use client";

import { Expand, ExternalLink, LogIn, MoreVertical, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { WebAuthState } from "@/supabase/auth-state";
import { recordOnboardingEvent } from "@/analytics/onboarding-analytics";
import { LandingAuthSurface } from "./landing-auth-surface";
import { landingFrames, storyNavFrames } from "./landing-content";
import type { LandingEntryState } from "./landing-entry";
import { legalDocLabels, legalDocSlugs, legalDocs, type LegalDocSlug } from "./legal-docs";

export function LandingExperience({
  initialAuthError,
  initialMode,
  initialOnboardingStep
}: LandingEntryState) {
  const initialAuthIndex = initialMode
    ? landingFrames.findIndex((frame) => "auth" in frame && frame.auth === initialMode)
    : -1;
  const initialProgress = initialAuthIndex >= 0
    ? initialAuthIndex / Math.max(1, landingFrames.length - 1)
    : 0;
  const shellRef = useRef<HTMLElement | null>(null);
  const copyRef = useRef<HTMLElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const authFrameLockRef = useRef<number | null>(initialAuthIndex >= 0 ? initialAuthIndex : null);
  const [legalDoc, setLegalDoc] = useState<LegalDocSlug | null>(null);
  const [legalExpanded, setLegalExpanded] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(initialAuthIndex >= 0 ? initialAuthIndex : 0);
  const [progress, setProgress] = useState(initialProgress);
  const activeFrame = landingFrames[activeIndex] ?? landingFrames[0];
  const activeAuth = "auth" in activeFrame ? activeFrame.auth : undefined;
  const publicAuthState = useMemo<WebAuthState>(
    () => ({ authenticated: false, configured: true, email: null }),
    []
  );

  const scrollToFrame = (index: number, behavior: ScrollBehavior = "smooth") => {
    const shell = shellRef.current;
    if (!shell) return;

    const boundedIndex = Math.min(landingFrames.length - 1, Math.max(0, index));
    authFrameLockRef.current = "auth" in landingFrames[boundedIndex]! ? boundedIndex : null;
    const target = storyMaxScroll(shell) * (boundedIndex / (landingFrames.length - 1));
    shell.scrollTo({ behavior, top: target });
  };

  useEffect(() => {
    document.documentElement.dataset.theme = "dark";
    recordOnboardingEvent("landing_viewed");

    const targetIndex = initialAuthIndex;

    if (targetIndex >= 0) {
      authFrameLockRef.current = targetIndex;
      const syncTargetFrame = () => {
        setActiveIndex(targetIndex);
        setProgress(targetIndex / Math.max(1, landingFrames.length - 1));
        scrollToFrame(targetIndex, "auto");
      };

      syncTargetFrame();
      window.requestAnimationFrame(syncTargetFrame);
      window.setTimeout(syncTargetFrame, 160);
      return;
    }

    window.requestAnimationFrame(() => {
      shellRef.current?.scrollTo({ top: 0 });
    });
  }, [initialAuthIndex]);

  useEffect(() => {
    if (activeAuth === "login") recordOnboardingEvent("login_opened");
    if (activeAuth === "onboard") recordOnboardingEvent("onboarding_opened");
  }, [activeAuth]);

  useEffect(() => {
    const shell = shellRef.current;

    if (!shell) {
      return;
    }

    let animationFrame = 0;
    const update = () => {
      animationFrame = 0;
      const maxScroll = storyMaxScroll(shell);
      const lockedIndex = authFrameLockRef.current;

      if (lockedIndex !== null) {
        const lockedProgress = lockedIndex / Math.max(1, landingFrames.length - 1);
        const lockedTop = maxScroll * lockedProgress;
        if (Math.abs(shell.scrollTop - lockedTop) > 1) {
          shell.scrollTo({ top: lockedTop });
        }
        setProgress(lockedProgress);
        setActiveIndex(lockedIndex);
        return;
      }

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
    let animation: { kill(): void } | undefined;

    async function animateCopy() {
      if (activeAuth || activeIndex === 0 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
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

      animation = gsap.fromTo(
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
      animation?.kill();
    };
  }, [activeAuth, activeIndex]);

  const cssVars = useMemo(
    () =>
      ({
        "--landing-progress": `${progress * 100}%`,
        "--landing-frame": activeIndex
      }) as CSSProperties,
    [activeIndex, progress]
  );

  return (
    <main className="landing-shell" data-auth-active={activeAuth ? "true" : undefined} ref={shellRef} style={cssVars}>
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
                aria-label="Continue to WeVid"
                className="landing-icon-button"
                onClick={(event) => {
                  event.preventDefault();
                  scrollToFrame(landingFrames.findIndex((frame) => frame.id === "login"), "auto");
                }}
                type="button"
              >
                <LogIn aria-hidden="true" size={18} />
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
                aria-label="Continue to WeVid"
                onClick={() => {
                  setMobileMenuOpen(false);
                  scrollToFrame(landingFrames.findIndex((frame) => frame.id === "login"), "auto");
                }}
                type="button"
              >
                <LogIn aria-hidden="true" size={15} />
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

          <section
            aria-labelledby={`${activeFrame.id}-title`}
            className={`landing-story ${activeAuth ? "landing-story-auth" : ""}`}
            id={activeFrame.id}
            key={activeFrame.id}
            ref={copyRef}
            tabIndex={activeAuth ? 0 : undefined}
          >
            <p className="landing-eyebrow" data-story-part>{activeFrame.kicker}</p>
            <h1 data-story-part id={`${activeFrame.id}-title`}>{activeFrame.title}</h1>
            <p className="landing-copy" data-story-part>{activeFrame.copy}</p>
            {initialAuthError && activeAuth ? (
              <p className="landing-auth-error" data-story-part>{initialAuthError}</p>
            ) : null}
            {!activeAuth ? (
              <div className="landing-cta-row" data-story-part>
                <button
                  className="landing-button"
                  data-tone="primary"
                  onClick={() => scrollToFrame(landingFrames.findIndex((frame) => frame.id === "login"), "auto")}
                  type="button"
                >
                  {activeFrame.primary}
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

function storyMaxScroll(shell: HTMLElement) {
  return Math.max(1, shell.clientHeight * (landingFrames.length - 1));
}
