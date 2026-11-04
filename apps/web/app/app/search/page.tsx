import { getDiscoverSearch } from "@/api-client";
import { requireAppAccess } from "@/supabase/route-guard";
import { AppShell } from "../../app-shell";
import { ErrorState } from "../../ui";
import { SearchExperience } from "./search-experience";

export const dynamic = "force-dynamic";

export default async function SearchPage({
  searchParams
}: {
  searchParams: Promise<{
    q?: string;
    contentCursor?: string;
    creatorCursor?: string;
    hashtagCursor?: string;
    eventCursor?: string;
    liveCursor?: string;
  }>;
}) {
  const session = await requireAppAccess("/app/search");
  const parameters = await searchParams;
  const query = parameters.q?.trim().slice(0, 120) ?? "";
  const result = await getDiscoverSearch(query, {
    ...(parameters.contentCursor ? { content: parameters.contentCursor } : {}),
    ...(parameters.creatorCursor ? { creators: parameters.creatorCursor } : {}),
    ...(parameters.hashtagCursor ? { hashtags: parameters.hashtagCursor } : {}),
    ...(parameters.eventCursor ? { events: parameters.eventCursor } : {}),
    ...(parameters.liveCursor ? { liveRooms: parameters.liveCursor } : {})
  });

  return (
    <AppShell>
      {result.ok ? (
        <SearchExperience actorUserId={session?.user?.id ?? null} initialResults={result.data} query={query} />
      ) : (
        <ErrorState result={result} title="Search is taking a moment" context="Search" />
      )}
    </AppShell>
  );
}
