import { LandingExperience } from "./landing-experience";
import { resolveLandingEntry } from "./landing-entry";

export default async function LandingPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <LandingExperience {...resolveLandingEntry(await searchParams)} />;
}
