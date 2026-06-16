export const dynamic = "force-dynamic";

const navItems = [
  ["Start", "#start"],
  ["Watch/Create", "#watch-create"],
  ["Why VEEL", "#why"],
  ["Earn", "#earn"],
  ["Partners", "#partners"],
  ["Trust", "#trust"]
] as const;

const storyFrames = [
  {
    id: "start",
    eyebrow: "Welcome to VEEL",
    title: "Own the room you light up.",
    body: "A verified 18+ media network for people who want their audience, income, and identity to stay theirs.",
    cta: "Enter VEEL",
    tone: "creators",
    proof: [
      ["Creator-owned", "Your profile, audience, wallet, and access state stay account-owned."],
      ["18+ by design", "Verified access opens the app; raw age documents never become UI data."],
      ["Media-first", "Video, live, messages, events, and premium unlocks share one account path."]
    ]
  },
  {
    id: "watch-create",
    eyebrow: "Watch / Create",
    title: "Everyone can watch. Anyone verified can create.",
    body: "Viewer, creator, Studio, and Enterprise capabilities are profile tiers, not separate worlds. Badges explain trust, access, and creator readiness without ranking people by spend.",
    cta: "Choose your path",
    tone: "media"
  },
  {
    id: "why",
    eyebrow: "Why VEEL",
    title: "The pain is real. The fix has to be real too.",
    body: "Creators need censorship-resistant distribution, age-restricted spaces, transparent access, fair discoverability, and direct non-custodial on-chain payments verified by the backend.",
    cta: "See the difference",
    tone: "wallet"
  },
  {
    id: "earn",
    eyebrow: "Earn",
    title: "Monetise access, not attention addiction.",
    body: "Creators can earn through premium unlocks, memberships, live passes, Event Access, paid messages, tips, support, and referral-attributed sales after confirmed settlement.",
    cta: "Start earning",
    tone: "earn"
  },
  {
    id: "partners",
    eyebrow: "Partners",
    title: "Invite. Share. Produce.",
    body: "Referral growth has three layers: invite people into VEEL, share creator moments externally, and run producer campaigns with audited partner governance.",
    cta: "Connect",
    tone: "partners"
  },
  {
    id: "trust",
    eyebrow: "Trust",
    title: "Privacy-first is the product.",
    body: "No raw age IDs in the frontend. No selling personal data. No ad-driven fatigue loops. Payments are transparent, peer-to-peer, and confirmed on-chain before access changes.",
    cta: "Verify access",
    tone: "verified"
  }
] as const;

const frameProof = {
  "watch-create": [
    ["Watch", "Follow, unlock, message, join lives, and attend events."],
    ["Create", "Publish media, sell access, and build a verified profile."],
    ["Tiers", "Studio and Enterprise unlock organization-grade profile capabilities."]
  ],
  why: [
    ["Censorship-resistant", "Provider boundaries reduce platform lock-in and arbitrary access drift."],
    ["Discoverable", "Content and creator surfaces are separated from money-based social priority."],
    ["Non-custodial", "Wallet approval is never payment proof; backend settlement is."]
  ],
  earn: [
    ["Premium access", "Unlocks, passes, memberships, messages, tips, and support."],
    ["Split settlement", "Creator/platform/referral facts settle without Veel-held balances."],
    ["Backend receipts", "Confirmed settlement writes durable activity and compliance evidence."]
  ],
  partners: [
    ["Invite", "Bring verified users and creators into the network."],
    ["Share", "External links can attribute creator moments server-side."],
    ["Producer", "Audited campaigns for serious partners and creator teams."]
  ],
  trust: [
    ["Minimal identity", "Safe verification state only; no raw age provider payloads in UI."],
    ["No ad fatigue", "No feed designed around selling attention to advertisers."],
    ["Transparent money", "Peer-to-peer wallet flows with backend-confirmed evidence."]
  ]
} as const;

export default function LandingPage() {
  const onboardingHref = "/enter?mode=onboarding&next=%2Fapp%2Fhome";
  const loginHref = "/enter?mode=login&next=%2Fapp%2Fhome";

  return (
    <main className="landing-shell">
      <header className="landing-nav">
        <a className="brand-lockup landing-brand" href="/" aria-label="VEEL">
          <span aria-hidden="true" className="theme-logo theme-logo-dark" />
          <span aria-hidden="true" className="theme-logo theme-logo-light" />
          <span>VEEL</span>
        </a>

        <nav className="landing-nav-links" aria-label="Landing sections">
          {navItems.map(([label, href]) => (
            <a href={href} key={href}>
              {label}
            </a>
          ))}
        </nav>

        <div className="landing-nav-actions">
          <a className="secondary-button" href={loginHref}>
            Log in
          </a>
          <a className="primary-button" href={onboardingHref}>
            Enter VEEL
          </a>
        </div>
      </header>

      <div className="landing-video-frame" aria-hidden="true">
        <div className="landing-video-subject" />
        <div className="landing-video-rail">
          {storyFrames.map((frame, index) => (
            <a href={`#${frame.id}`} key={frame.id} aria-label={frame.eyebrow}>
              <span data-active={index === 0 ? "true" : undefined} />
            </a>
          ))}
        </div>
      </div>

      <div className="landing-story">
        {storyFrames.map((frame) => (
          <section className="landing-frame" data-tone={frame.tone} id={frame.id} key={frame.id}>
            <div className="landing-frame-copy">
              <p>{frame.eyebrow}</p>
              <h1>{frame.title}</h1>
              <span>{frame.body}</span>
              <div className="landing-frame-actions">
                <a className="primary-button" href={onboardingHref}>
                  {frame.cta}
                </a>
              </div>
            </div>

            <div className="landing-frame-meta" aria-label={`${frame.eyebrow} proof points`}>
              {proofForFrame(frame).map(([label, value]) => (
                <div key={label}>
                  <LandingIcon name={iconForProof(label)} />
                  <strong>{label}</strong>
                  <span>{value}</span>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      <footer className="landing-footer">
        <span>© 2026 VEEL</span>
        <a href="/legal">Legal</a>
        <a href="/terms">Terms</a>
        <a href="/privacy">Privacy</a>
        <a href="/cookies">Cookies</a>
        <a href="/community-rules">Community Rules</a>
        <a href="/safety">Safety</a>
        <a href="/contact">Contact</a>
        <span>Built on Solana</span>
      </footer>
    </main>
  );
}

type StoryFrame = (typeof storyFrames)[number];

type LandingIconName = "creators" | "earn" | "media" | "partners" | "shield" | "verified" | "wallet";

function proofForFrame(frame: StoryFrame) {
  if ("proof" in frame) {
    return frame.proof;
  }

  switch (frame.id) {
    case "watch-create":
      return frameProof["watch-create"];
    case "why":
      return frameProof.why;
    case "earn":
      return frameProof.earn;
    case "partners":
      return frameProof.partners;
    case "trust":
      return frameProof.trust;
  }
}

function iconForProof(label: string): LandingIconName {
  if (label === "Non-custodial" || label === "Split settlement" || label === "Transparent money") {
    return "wallet";
  }

  if (label === "Backend receipts" || label === "18+ by design" || label === "Minimal identity") {
    return "verified";
  }

  if (label === "Invite" || label === "Share" || label === "Producer") {
    return "partners";
  }

  if (label === "Premium access" || label === "Tiers") {
    return "earn";
  }

  if (label === "Watch" || label === "Create" || label === "Media-first") {
    return "media";
  }

  if (label === "Creator-owned" || label === "Discoverable") {
    return "creators";
  }

  return "shield";
}

function LandingIcon({ name }: { name: LandingIconName }) {
  const path = {
    creators: "M16 11a4 4 0 1 0-8 0m8 0a4 4 0 1 1-8 0m8 0c2.8.7 5 2.4 5 5v1H3v-1c0-2.6 2.2-4.3 5-5",
    earn: "M13 3 4 14h7l-1 7 9-12h-7l1-6Z",
    media: "M4 6h16v12H4V6Zm6 3 5 3-5 3V9Z",
    partners: "M8 12h8m-4-4v8M4 6h16v12H4V6Z",
    shield: "M12 3 5 6v5c0 4.5 2.8 8.2 7 10 4.2-1.8 7-5.5 7-10V6l-7-3Zm-3 9 2 2 4-5",
    verified: "M20 7 9 18l-5-5m12-9 4 3-4 3-4-3 4-3Z",
    wallet: "M4 7h15a1 1 0 0 1 1 1v11H4V7Zm0 0 3-3h10v3m11 5h-5v4h5v-4Z"
  } satisfies Record<LandingIconName, string>;

  return (
    <svg aria-hidden="true" className="landing-icon" fill="none" viewBox="0 0 24 24">
      <path d={path[name]} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  );
}
