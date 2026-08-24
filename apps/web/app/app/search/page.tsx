import { getDiscoverSearch } from "@/api-client";
import { requireAppAccess } from "@/supabase/route-guard";
import { AppShell } from "../../app-shell";
import { ErrorState } from "../../ui";
import { SearchExperience } from "./search-experience";

export const dynamic = "force-dynamic";

export default async function SearchPage({
  searchParams
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireAppAccess("/app/search");
  const query = (await searchParams).q?.trim().slice(0, 120) ?? "";
  const result = await getDiscoverSearch(query);

  return (
    <AppShell>
      {result.ok ? (
        <SearchExperience initialResults={result.data} query={query} />
      ) : (
        <ErrorState result={result} title="Search is taking a moment" context="Search" />
      )}
    </AppShell>
  );
}
