import { getFeedPreferences, getHomeFeed } from "@/api-client";
import { requireAppAccess } from "@/supabase/route-guard";
import { AppShell } from "../../app-shell";
import { ErrorState } from "../../ui";
import { FeedExperience } from "../feed-experience";

export const dynamic = "force-dynamic";

export default async function BitsPage() {
  await requireAppAccess("/app/bits");
  const preferences = await getFeedPreferences();
  const feed = await getHomeFeed(
    preferences.ok ? preferences.data.defaultMode : "recommended",
    "bits"
  );

  return (
    <AppShell>
      {feed.ok ? (
        <FeedExperience
          initialContentPreference={preferences.ok ? preferences.data.nsfwPreference : "both"}
          initialPage={feed.data}
          surface="bits"
        />
      ) : (
        <ErrorState result={feed} title="Bits need your session" context="Bits feed" />
      )}
    </AppShell>
  );
}
