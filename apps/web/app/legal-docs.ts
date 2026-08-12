export const legalDocs = {
  legal:
    "WeVid is a pre-launch 18+ creator platform. Public access requires final Terms, Privacy Policy, Community Rules, and Safety Policy approval before production launch.",
  terms:
    "Use of WeVid will require verified access, lawful content, and respect for creator, viewer, payment, and safety policies.",
  privacy:
    "WeVid is designed to show safe status, not raw provider payloads. Age documents, private keys, provider secrets, and service-role credentials never belong in browser UI.",
  cookies:
    "Cookies should be limited to session, safety, and preference needs. Marketing or analytics cookies require explicit product and legal approval.",
  community:
    "WeVid is for verified 18+ media communities. Abuse, coercion, spam, payment manipulation, and attempts to bypass safety or age gates are not acceptable.",
  safety:
    "Age, wallet, creator, and access readiness are backend-owned trust states. The frontend guides users but cannot self-approve protected access.",
  contact:
    "Production contact channels will cover support, legal, safety, creator operations, and provider escalation paths."
} as const;

export const legalDocLabels = {
  legal: "Legal",
  terms: "Terms",
  privacy: "Privacy",
  cookies: "Cookies",
  community: "Community Rules",
  safety: "Safety",
  contact: "Contact"
} as const satisfies Record<LegalDocSlug, string>;

export type LegalDocSlug = keyof typeof legalDocs;

export const legalDocSlugs = Object.keys(legalDocs) as LegalDocSlug[];
