export const landingFrames = [
  {
    id: "welcome",
    label: "Welcome",
    kicker: "WeVid - Frame Your Way",
    title: "Create without asking the algorithm for permission.",
    copy:
      "A creator network for adults tired of censorship, ad dependency, privacy leaks, buried discovery, and payment systems that make direct support feel complicated.",
    primary: "Continue to WeVid",
    visual: "intro"
  },
  {
    id: "watch-create",
    label: "Watch / Create",
    kicker: "Watch freely. Create verified.",
    title: "Watch freely. Create verified.",
    copy:
      "Viewers can discover and support. Verified creators can publish, unlock, go live, and build paid access.",
    primary: "Continue to WeVid",
    visual: "access"
  },
  {
    id: "why-wevid",
    label: "Why WeVid",
    kicker: "Audience ownership",
    title: "Your audience should not belong to an ad network.",
    copy:
      "WeVid gives creators a verified, privacy-first space where access, payments, and community are not controlled by opaque ranking games.",
    primary: "Continue to WeVid",
    visual: "trust"
  },
  {
    id: "earn",
    label: "Earn",
    kicker: "Direct support",
    title: "Get paid without giving up control.",
    copy:
      "Support, unlocks, memberships, and event access are tied to user-owned wallets and backend-verified access states. Fast, low-fee Solana settlement.",
    primary: "Continue to WeVid",
    visual: "earn"
  },
  {
    id: "partners",
    label: "Partners",
    kicker: "Provider-ready",
    title: "Provider-ready. Not provider-owned.",
    copy:
      "Wallet, age, media, live, safety, and auth providers plug into a WeVid trust layer without becoming the product.",
    primary: "Continue to WeVid",
    visual: "partner"
  },
  {
    id: "trust",
    label: "Trust",
    kicker: "18+ by design",
    title: "18+ by design. Private by default.",
    copy:
      "Wallet readiness, profile state, and age verification unlock the app. Raw provider documents never become UI data.",
    primary: "Continue to WeVid",
    visual: "trust"
  },
  {
    id: "onboarding",
    label: "Onboarding",
    kicker: "Join WeVid",
    title: "Set up your account.",
    copy: "Connect your wallet, choose a handle, and confirm 18+ access.",
    primary: "Continue setup",
    visual: "start",
    auth: "onboard"
  },
  {
    id: "login",
    label: "Continue",
    kicker: "Your WeVid account",
    title: "Continue to WeVid.",
    copy: "Choose an existing sign-in method. If no account is found, you can start onboarding before anything is created.",
    primary: "Continue to WeVid",
    visual: "login",
    auth: "login"
  }
] as const;

export const storyNavFrames = landingFrames.filter((frame) => !("auth" in frame));
