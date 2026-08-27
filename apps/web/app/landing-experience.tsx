"use client";

import {
  ArrowDown,
  ArrowRight,
  BadgeCheck,
  BarChart3,
  CalendarCheck2,
  Check,
  ChevronDown,
  CircleDollarSign,
  HeartHandshake,
  Menu,
  Play,
  QrCode,
  ShieldCheck,
  ShoppingBag,
  UsersRound,
  X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WebAuthState } from "@/supabase/auth-state";
import { recordOnboardingEvent } from "@/analytics/onboarding-analytics";
import { LandingAuthSurface } from "./landing-auth-surface";
import { landingContent } from "./landing-content";
import type { LandingEntryMode, LandingEntryState } from "./landing-entry";
import { legalDocLabels, legalDocSlugs } from "./legal-docs";

const productIcons = {
  media: Play,
  mutuals: HeartHandshake,
  events: QrCode,
  commerce: ShoppingBag
} as const;

export function LandingExperience({
  initialAuthError,
  initialMode,
  initialOnboardingStep
}: LandingEntryState) {
  const [authMode, setAuthMode] = useState<Exclude<LandingEntryMode, null> | null>(initialMode);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const authOpenerKeyRef = useRef<string | null>(null);
  const publicAuthState = useMemo<WebAuthState>(
    () => ({ authenticated: false, configured: true, email: null }),
    []
  );

  const openContinue = useCallback((source: string) => {
    recordOnboardingEvent("landing_cta_clicked", source);
    authOpenerKeyRef.current = source;
    setMobileMenuOpen(false);
    setAuthMode("login");
  }, []);

  useEffect(() => {
    recordOnboardingEvent("landing_viewed");
  }, []);

  useEffect(() => {
    if (!authMode) return;
    recordOnboardingEvent(authMode === "login" ? "login_opened" : "onboarding_opened");
    window.scrollTo({ top: 0 });
  }, [authMode]);

  useEffect(() => {
    if (authMode) return;
    const observed = [...document.querySelectorAll<HTMLElement>("[data-landing-section]")];
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const section = (entry.target as HTMLElement).dataset.landingSection ?? "unknown";
            recordOnboardingEvent("landing_section_viewed", section);
            if (section === "money") recordOnboardingEvent("landing_money_example_viewed");
            if (section === "comparison") recordOnboardingEvent("landing_comparison_viewed");
          }
        });
      },
      { threshold: 0.45 }
    );
    observed.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [authMode]);

  const closeAuth = useCallback(() => {
    setAuthMode(null);
    window.requestAnimationFrame(() => {
      const key = authOpenerKeyRef.current;
      const source = [...document.querySelectorAll<HTMLElement>("[data-landing-auth-opener]")]
        .find((element) => element.dataset.landingAuthOpener === key && element.getClientRects().length > 0);
      const fallback = [...document.querySelectorAll<HTMLElement>("[data-landing-auth-opener]")]
        .find((element) => element.getClientRects().length > 0);
      (source ?? fallback)?.focus();
    });
  }, []);

  if (authMode) {
    return (
      <main className="landing-shell landing-auth-page">
        <a className="landing-skip-link" href="#landing-auth-main">Skip to sign in</a>
        <div aria-hidden="true" className="landing-auth-page-media">
          <img alt="" height="941" src="/images/wevid-landing-hero-v2.jpg" width="1672" />
        </div>
        <div aria-hidden="true" className="landing-auth-page-scrim" />
        <header className="landing-auth-page-header">
          <a className="landing-logo-link" href="/" aria-label="WeVid home">
            <img alt="" height="40" src="/Logo-Light-Transparent.png" width="40" />
            <span><strong>WeVid</strong><small>FRAME YOUR WAY</small></span>
          </a>
          {initialMode === null ? (
            <button aria-label="Back to WeVid" className="landing-auth-close" onClick={closeAuth} type="button">
              <X aria-hidden="true" />
            </button>
          ) : (
            <a aria-label="Back to WeVid" className="landing-auth-close" href="/"><X aria-hidden="true" /></a>
          )}
        </header>
        <section className="landing-auth-stage" id="landing-auth-main">
          <div className="landing-auth-heading">
            <p>ONE CLEAN ENTRY</p>
            <h1 id="landing-auth-title">Continue to WeVid.</h1>
            <span>Choose a wallet or Privy. Known accounts continue; new identities move into onboarding before a wallet or account is created.</span>
          </div>
          {initialAuthError ? <p className="landing-auth-error">{initialAuthError}</p> : null}
          <LandingAuthSurface authState={publicAuthState} initialOnboardingStep={initialOnboardingStep} mode={authMode} />
          <p className="landing-auth-footnote"><ShieldCheck aria-hidden="true" />Signing proves wallet ownership. It never approves a payment.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="landing-shell">
      <a className="landing-skip-link" href="#landing-main">Skip to main content</a>
      <header className="landing-header">
        <a className="landing-logo-link" href="/" aria-label="WeVid home">
          <img alt="" height="40" src="/Logo-Light-Transparent.png" width="40" />
          <span><strong>WeVid</strong><small>FRAME YOUR WAY</small></span>
        </a>
        <nav aria-label="Landing navigation" className="landing-desktop-nav">
          {landingContent.navigation.map((item) => (
            <a
              href={item.href}
              key={item.href}
              onClick={() => recordOnboardingEvent("landing_nav_clicked", item.href.slice(1))}
            >
              {item.label}
            </a>
          ))}
        </nav>
        <button className="landing-header-cta" data-landing-auth-opener="header" onClick={() => openContinue("header")} type="button">
          Continue <ArrowRight aria-hidden="true" size={16} />
        </button>
        <button
          aria-expanded={mobileMenuOpen}
          aria-label={mobileMenuOpen ? "Close navigation" : "Open navigation"}
          className="landing-menu-button"
          onClick={() => setMobileMenuOpen((open) => !open)}
          type="button"
        >
          {mobileMenuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
        </button>
        <div className="landing-mobile-menu" data-open={mobileMenuOpen ? "true" : undefined}>
          {landingContent.navigation.map((item) => (
            <a
              href={item.href}
              key={item.href}
              onClick={() => {
                recordOnboardingEvent("landing_nav_clicked", item.href.slice(1));
                setMobileMenuOpen(false);
              }}
            >
              {item.label}<ArrowRight aria-hidden="true" size={16} />
            </a>
          ))}
          <button data-landing-auth-opener="mobile-menu" onClick={() => openContinue("mobile-menu")} type="button">Continue to WeVid</button>
        </div>
      </header>

      <div id="landing-main">
        <section className="landing-hero" data-landing-section="hero">
          <div className="landing-hero-media" aria-hidden="true">
            <img alt="" height="941" src="/images/wevid-landing-hero-v2.jpg" width="1672" />
          </div>
          <div className="landing-hero-scrim" aria-hidden="true" />
          <div className="landing-hero-content">
            <p className="landing-eyebrow">{landingContent.hero.eyebrow}</p>
            <h1>{landingContent.hero.title}</h1>
            <p className="landing-hero-copy">{landingContent.hero.copy}</p>
            <div className="landing-hero-actions">
              <button className="landing-primary-button" data-landing-auth-opener="hero" onClick={() => openContinue("hero")} type="button">
                {landingContent.hero.primary}<ArrowRight aria-hidden="true" size={18} />
              </button>
              <a className="landing-secondary-button" href="#why">
                {landingContent.hero.secondary}<ArrowDown aria-hidden="true" size={18} />
              </a>
            </div>
            <p className="landing-hero-note"><ShieldCheck aria-hidden="true" size={16} />{landingContent.hero.note}</p>
          </div>
          <p className="landing-scroll-cue"><span>WHY FIRST</span><ArrowDown aria-hidden="true" size={14} /></p>
        </section>

        <section aria-label="Verified WeVid product facts" className="landing-proof" data-landing-section="proof">
          {landingContent.proof.map((fact) => (
            <div key={fact.claim.id}>
              <strong>{fact.value}</strong>
              <span>{fact.label}</span>
              <small>{fact.claim.qualification}</small>
            </div>
          ))}
        </section>

        <section className="landing-problem landing-section" data-landing-section="why" id="why">
          <div className="landing-section-heading">
            <p className="landing-eyebrow">{landingContent.problem.eyebrow}</p>
            <h2>{landingContent.problem.title}</h2>
            <p>{landingContent.problem.intro}</p>
          </div>
          <div className="landing-pain-lines" aria-label="Common creator pain points">
            {landingContent.problem.pains.map(([lead, rest], index) => (
              <p key={lead}><span>0{index + 1}</span><strong>{lead}</strong><em>{rest}</em></p>
            ))}
          </div>
        </section>

        <section className="landing-product landing-section" data-landing-section="product" id="product">
          <div className="landing-section-heading landing-section-heading-wide">
            <p className="landing-eyebrow">{landingContent.product.eyebrow}</p>
            <h2>{landingContent.product.title}</h2>
            <p>{landingContent.product.copy}</p>
          </div>
          <div className="landing-loop" aria-label="WeVid creator loop">
            {["Create", "Discover", "Connect", "Unlock / Support", "Settle", "Learn"].map((item, index, all) => (
              <span key={item}>{item}{index < all.length - 1 ? <ArrowRight aria-hidden="true" size={14} /> : null}</span>
            ))}
          </div>
          <div className="landing-feature-list">
            {landingContent.product.features.map((feature) => {
              const Icon = productIcons[feature.id];
              return (
                <article className="landing-feature" data-feature={feature.id} key={feature.id}>
                  <div className="landing-feature-copy">
                    <span>{feature.index} / {feature.label}</span>
                    <h3>{feature.title}</h3>
                    <p>{feature.copy}</p>
                  </div>
                  <FeatureVisual id={feature.id} icon={Icon} />
                </article>
              );
            })}
          </div>
        </section>

        <section className="landing-money landing-section" data-landing-section="money" id="money">
          <div className="landing-money-copy">
            <p className="landing-eyebrow">{landingContent.money.eyebrow}</p>
            <h2>{landingContent.money.title}</h2>
            <p>{landingContent.money.copy}</p>
            <ul>
              {landingContent.money.boundaries.map((boundary) => <li key={boundary}><Check aria-hidden="true" />{boundary}</li>)}
            </ul>
          </div>
          <div className="landing-money-visuals">
            <div className="landing-payment-flow" aria-label="Solana Pay checkout lifecycle">
              {landingContent.money.flow.map((step, index) => (
                <div key={step.index}>
                  <span>{step.index}</span>
                  <strong>{step.label}</strong>
                  <small>{step.copy}</small>
                  {index < landingContent.money.flow.length - 1 ? <ArrowRight aria-hidden="true" /> : null}
                </div>
              ))}
            </div>
            <div className="landing-split" aria-label="Illustrative one USDC settlement split">
              <div className="landing-split-total"><span>Buyer approves</span><strong>{landingContent.money.example.gross} <small>{landingContent.money.example.currency}</small></strong></div>
              <ArrowDown aria-hidden="true" />
              <div className="landing-split-recipients">
                <div><span>Creator recipient</span><strong>{landingContent.money.example.creator}</strong></div>
                <div><span>WeVid recipient</span><strong>{landingContent.money.example.platform}</strong></div>
              </div>
              <div className="landing-allocation-rules">
                {landingContent.money.allocationRules.map(([label, value]) => <p key={label}><span>{label}</span><strong>{value}</strong></p>)}
              </div>
              <p>{landingContent.money.example.claim.qualification} {landingContent.money.disclosure}</p>
            </div>
          </div>
        </section>

        <section className="landing-plans landing-section" data-landing-section="studio" id="studio">
          <div className="landing-section-heading landing-section-heading-wide">
            <p className="landing-eyebrow">{landingContent.plans.eyebrow}</p>
            <h2>{landingContent.plans.title}</h2>
            <p>{landingContent.plans.copy}</p>
          </div>
          <div className="landing-plan-track">
            {landingContent.plans.items.map((plan) => (
              <article id={plan.name === "Enterprise" ? "enterprise" : undefined} key={plan.name}>
                <span>{plan.name === "Studio" ? <BarChart3 aria-hidden="true" /> : plan.name === "Enterprise" ? <UsersRound aria-hidden="true" /> : <BadgeCheck aria-hidden="true" />}</span>
                <small>{plan.scope}</small>
                <h3>{plan.name}</h3>
                <p>{plan.copy}</p>
                <ul>{plan.capabilities.map((capability) => <li key={capability}>{capability}</li>)}</ul>
              </article>
            ))}
          </div>
          <p className="landing-plan-boundary"><ShieldCheck aria-hidden="true" />{landingContent.plans.boundary.wording}. {landingContent.plans.boundary.qualification}</p>
        </section>

        <section className="landing-comparison landing-section" data-landing-section="comparison">
          <div className="landing-section-heading">
            <p className="landing-eyebrow">{landingContent.comparison.eyebrow}</p>
            <h2>{landingContent.comparison.title}</h2>
            <p>{landingContent.comparison.qualification}</p>
          </div>
          <div className="landing-comparison-table" role="table" aria-label="Common old platform patterns compared with the WeVid model">
            <div className="landing-comparison-head" role="row"><span role="columnheader">Common category pattern</span><span role="columnheader">WeVid model</span></div>
            {landingContent.comparison.rows.map(([oldModel, wevidModel]) => (
              <div key={oldModel} role="row"><span aria-label={`Common category pattern: ${oldModel}`} role="cell">{oldModel}</span><strong aria-label={`WeVid model: ${wevidModel}`} role="cell"><ArrowRight aria-hidden="true" />{wevidModel}</strong></div>
            ))}
          </div>
        </section>

        <section className="landing-trust landing-section" data-landing-section="trust" id="trust">
          <div className="landing-trust-mark" aria-hidden="true"><ShieldCheck /></div>
          <div>
            <p className="landing-eyebrow">{landingContent.trust.eyebrow}</p>
            <h2>{landingContent.trust.title}</h2>
            <p>{landingContent.trust.copy}</p>
            <ul>{landingContent.trust.points.map((point) => <li key={point}><Check aria-hidden="true" />{point}</li>)}</ul>
          </div>
        </section>

        <section className="landing-faq landing-section" data-landing-section="faq">
          <div className="landing-section-heading">
            <p className="landing-eyebrow">STRAIGHT ANSWERS</p>
            <h2>Know what you are joining.</h2>
          </div>
          <div className="landing-faq-list">
            {landingContent.faq.map(([question, answer], index) => (
              <details
                key={question}
                onToggle={(event) => {
                  if (event.currentTarget.open) recordOnboardingEvent("landing_faq_opened", `faq-${index + 1}`);
                }}
              >
                <summary>{question}<ChevronDown aria-hidden="true" /></summary>
                <p>{answer}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="landing-final-cta" data-landing-section="final-cta">
          <p className="landing-eyebrow">YOUR NEXT MOVE</p>
          <h2>Build where the relationship can compound.</h2>
          <button className="landing-primary-button" data-landing-auth-opener="final" onClick={() => openContinue("final")} type="button">
            Continue to WeVid<ArrowRight aria-hidden="true" />
          </button>
          <p>One entry. Existing accounts continue. New people choose onboarding first.</p>
        </section>
      </div>

      <footer className="landing-footer">
        <a className="landing-logo-link" href="/" aria-label="WeVid home">
          <img alt="" height="36" src="/Logo-Light-Transparent.png" width="36" />
          <span><strong>WeVid</strong><small>FRAME YOUR WAY</small></span>
        </a>
        <p>Creator-first social, access and business tools. 18+.</p>
        <nav aria-label="Legal links">
          {legalDocSlugs.map((slug) => <a href={`/legal/${slug}`} key={slug}>{legalDocLabels[slug]}</a>)}
        </nav>
        <span>© 2026 WeVid</span>
      </footer>

    </main>
  );
}

function FeatureVisual({ id, icon: Icon }: { id: keyof typeof productIcons; icon: typeof Play }) {
  if (id === "media") {
    return (
      <div aria-hidden="true" className="landing-product-visual landing-media-visual">
        <div className="landing-media-frame"><span>WEVID / MEDIA</span><Play fill="currentColor" /><small>Creator · 00:18</small></div>
        <div className="landing-action-rail"><HeartHandshake /><CircleDollarSign /><BadgeCheck /></div>
      </div>
    );
  }
  if (id === "mutuals") {
    return (
      <div aria-hidden="true" className="landing-product-visual landing-mutuals-visual">
        <div className="landing-person landing-person-a">YOU</div>
        <HeartHandshake />
        <div className="landing-person landing-person-b">THEM</div>
        <p><BadgeCheck />Both connect <span>Conversation opens</span></p>
      </div>
    );
  }
  if (id === "events") {
    return (
      <div aria-hidden="true" className="landing-product-visual landing-event-visual">
        <div><span>EVENT ACCESS</span><strong>Night Session</strong><small><CalendarCheck2 />Pass verified</small></div>
        <QrCode />
      </div>
    );
  }
  return (
    <div aria-hidden="true" className="landing-product-visual landing-commerce-visual">
      <div className="landing-product-shape"><Icon /></div>
      <div><span>ATTACHED TO MEDIA</span><strong>Product Offer</strong><small>Planned · approval gated</small></div>
    </div>
  );
}
