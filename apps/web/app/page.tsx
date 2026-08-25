import type { Metadata } from "next";
import { LandingExperience } from "./landing-experience";
import { resolveLandingEntry } from "./landing-entry";

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: "WeVid — Stop Building on Rented Ground",
  description: "A creator-first 18+ social network for media, Mutuals, Event Access, direct wallet-approved settlement, Studio and permissioned Enterprise operations.",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "WeVid",
    title: "WeVid — Stop Building on Rented Ground",
    description: "Media, real connections, verified access and creator business tools in one network."
  },
  twitter: {
    card: "summary",
    title: "WeVid — Stop Building on Rented Ground",
    description: "Media, real connections, verified access and creator business tools in one network."
  }
};

export default async function LandingPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${appUrl}/#organization`,
        name: "WeVid",
        url: appUrl
      },
      {
        "@type": "WebSite",
        "@id": `${appUrl}/#website`,
        name: "WeVid",
        url: appUrl,
        publisher: { "@id": `${appUrl}/#organization` }
      },
      {
        "@type": "SoftwareApplication",
        name: "WeVid",
        applicationCategory: "SocialNetworkingApplication",
        operatingSystem: "Web",
        url: appUrl,
        description: "An 18+ creator-first social PWA for media, connections, verified access and creator business tools."
      }
    ]
  };

  return (
    <>
      <script
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replaceAll("<", "\\u003c") }}
        type="application/ld+json"
      />
      <LandingExperience {...resolveLandingEntry(await searchParams)} />
    </>
  );
}
