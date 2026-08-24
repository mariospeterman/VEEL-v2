import { getFeedPreferences, getHomeFeed } from "@/api-client";
import { requireAppAccess } from "@/supabase/route-guard";
import { AppShell } from "../../app-shell";
import { ErrorState } from "../../ui";
import { MomentViewer } from "./moment-viewer";

export const dynamic = "force-dynamic";

export default async function MomentsPage({
  searchParams
}: {
  searchParams: Promise<{ start?: string }>;
}) {
  await requireAppAccess("/app/moments");
  const [params, preferences] = await Promise.all([searchParams, getFeedPreferences()]);
  const feed = await getHomeFeed(
    preferences.ok ? preferences.data.defaultMode : "recommended",
    "moments"
  );

  return (
    <AppShell>
      {feed.ok ? (
        <MomentViewer
          initialPage={feed.data}
          startId={params.start ?? null}
        />
      ) : (
        <ErrorState result={feed} title="Moments need your session" context="Moments" />
      )}
    </AppShell>
  );
}
