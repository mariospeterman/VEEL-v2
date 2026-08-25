import { approvedLandingClaim, landingMoneyExample } from "./landing-claims";

export const landingContent = {
  navigation: [
    { href: "#product", label: "Product" },
    { href: "#money", label: "Money" },
    { href: "#trust", label: "Trust" },
    { href: "#studio", label: "Studio" },
    { href: "#enterprise", label: "Enterprise" }
  ],
  hero: {
    eyebrow: "CREATOR-FIRST SOCIAL · 18+",
    title: "Stop building on rented ground.",
    copy: "You did not build an audience to rent it back through ads, chase a shifting algorithm or guess which attention is real. WeVid connects media, real relationships, direct access and creator business tools—without selling organic reach back to you.",
    primary: "Continue to WeVid",
    secondary: "See how it works",
    note: "Known identity? You sign in. New here? We ask before onboarding creates anything."
  },
  proof: [
    { value: "1", label: "wallet-approved transaction", claim: approvedLandingClaim("checkout-one-approval") },
    { value: "10%", label: "default platform fee", claim: approvedLandingClaim("default-platform-fee") },
    { value: "0", label: "WeVid balances or withdrawal queues", claim: approvedLandingClaim("no-platform-balances") },
    { value: "0", label: "pay-to-rank mechanics", claim: approvedLandingClaim("no-pay-to-rank") }
  ],
  problem: {
    eyebrow: "THE RENTED CREATOR ECONOMY",
    title: "You create the value. The old model keeps the leverage.",
    intro: "A profile decision can separate you from the audience you built. Fake attention can fill a room while real connections get buried. Money and work still cross a scattered stack you do not control.",
    pains: [
      ["Reach", "that moves with an algorithm"],
      ["Access", "tied to one profile"],
      ["Attention", "that may not be real"],
      ["Money", "sent through another queue"]
    ]
  },
  product: {
    eyebrow: "ONE NETWORK · ONE CREATOR LOOP",
    title: "Make something worth staying for.",
    copy: "Create, discover, connect, unlock or support, settle, learn—and create again. Each step uses the same identity, content, access and analytics truth.",
    features: [
      {
        id: "media",
        index: "01",
        label: "Media first",
        title: "The work stays in focus.",
        copy: "Photos, video, Bits, live and replay lead the experience. Follows, comments, saves and shares stay attached to the media—not buried in a dashboard."
      },
      {
        id: "mutuals",
        index: "02",
        label: "Mutuals",
        title: "Real interest requires both sides.",
        copy: "Mutuals is opt-in. When both people choose to connect, conversation opens inside Messages. Payment never buys a match, a reply or inbox priority."
      },
      {
        id: "events",
        index: "03",
        label: "Event Access",
        title: "From media to the door.",
        copy: "Creators can offer verified access to live or in-person experiences. Backend-confirmed Passes carry QR and check-in state without turning a wallet approval into access proof."
      },
      {
        id: "commerce",
        index: "04",
        label: "Product Offers · planned rollout",
        title: "Let the content become the storefront.",
        copy: "The product direction attaches a focused offer to a profile, Post, Bit or live stream. Rollout remains gated by seller, product-safety, shipping, tax and operations approval."
      }
    ]
  },
  money: {
    eyebrow: "NONCUSTODIAL BY DESIGN",
    title: "One approval. One verified split. No WeVid balance.",
    copy: "The buyer approves a server-composed transaction. The network confirms it. WeVid verifies settlement before access changes and records the receipt.",
    example: {
      ...landingMoneyExample,
      claim: approvedLandingClaim("one-usdc-example")
    },
    disclosure: "Illustrative default-fee example. WeVid provides software and verified access records; it is not a bank and does not hold creator product funds in platform balances. Network and provider conditions apply."
  },
  plans: {
    eyebrow: "CAPABILITIES, NOT SOCIAL ADVANTAGE",
    title: "Plans extend your workspace—not your rank.",
    copy: "Free, Plus and Ultra shape viewing and convenience. Studio adds professional tools to an individual creator account. Enterprise adds a permissioned organization workspace.",
    items: [
      { name: "Plus", copy: "More viewing, collections, notification and profile controls." },
      { name: "Ultra", copy: "Higher allowances and advanced playback convenience." },
      { name: "Studio", copy: "Individual creator analytics, scheduling, pricing and live-conversion tools." },
      { name: "Enterprise", copy: "Organization RBAC, managed-creator consent, consolidated reporting and operations." }
    ],
    boundary: approvedLandingClaim("no-pay-to-rank")
  },
  comparison: {
    eyebrow: "A DIFFERENT OPERATING MODEL",
    title: "Keep the audience relationship closer to the work.",
    qualification: "The left side describes common category patterns; it is not a claim about every platform.",
    rows: [
      ["Platform balance or payout queue", "Wallet-approved recipient split"],
      ["Feed, chat and commerce separated", "Context stays connected"],
      ["Commercial promotion affects distribution", "Money never buys organic WeVid ranking"],
      ["Creator tools scattered", "One Studio data authority"]
    ]
  },
  trust: {
    eyebrow: "OPEN TO EXPRESSION · CLOSED TO EXPLOITATION",
    title: "Expression needs boundaries people can trust.",
    copy: "WeVid separates age access, creator earnings, adult publishing, performer evidence, content moderation and staff authority. Each capability is checked for its own purpose.",
    points: ["18+ access before protected entry", "Consent and rights evidence", "Server-authorized access and moderation", "Permission-based staff operations"]
  },
  faq: [
    ["Is Continue to WeVid login or signup?", "Both, without guessing. We authenticate the method you choose. A known identity signs in; an unknown identity must explicitly start the three-step onboarding flow before an account or embedded wallet is created."],
    ["Does WeVid hold creator money?", "No internal creator balance or withdrawal queue is part of the architecture. Users approve wallet transactions and WeVid verifies settlement before granting access."],
    ["Can I pay for more reach or better Mutuals results?", "No. Plans buy software capabilities and access. Money never buys organic ranking, Mutuals treatment, message priority or preferential social treatment."],
    ["What is Studio?", "Studio is the individual creator capability tier and workspace for analytics, scheduling, pricing and other professional tools. It extends the same account and profile; it is not a second app or organization account."],
    ["What is Enterprise?", "Enterprise is the organization workspace for agencies, teams, venues and approved partners. Access is contract- and permission-based, with creator consent and backend-owned RBAC."],
    ["Are Product Offers available now?", "Product Offers are the approved product direction, not a launch claim. They remain gated until seller, product-safety, fulfillment, privacy, tax, refund and operational requirements are implemented and approved."]
  ]
} as const;
