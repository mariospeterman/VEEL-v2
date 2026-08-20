import {
  getDiscoverSearch,
  getFeedPreferences,
  getHomeFeed,
  type LiveRoom
} from "@/api-client";
import { requireAppAccess } from "@/supabase/route-guard";
import { formatAssetAmount } from "@/format-asset-amount";
import { AppShell } from "../../app-shell";
import { Card, EmptyState, ErrorState, Fact, PageHeader, StatusPill } from "../../ui";
import { FeedExperience } from "../feed-experience";

export const dynamic = "force-dynamic";

export default async function AppHomePage() {
  await requireAppAccess("/app/home");

  const preferences = await getFeedPreferences();
  const initialMode = preferences.ok ? preferences.data.defaultMode : "recommended";
  const [feed, discover] = await Promise.all([
    getHomeFeed(initialMode, "home"),
    getDiscoverSearch("")
  ]);
  const liveRooms = discover.ok ? discover.data.liveRooms.slice(0, 3) : [];

  return (
    <AppShell>
      <PageHeader
        action={<StatusPill tone="good">Ready</StatusPill>}
        eyebrow="Home"
        title="Your feed"
      >
        New posts from creators you follow, plus recommendations chosen for you.
      </PageHeader>

      <section className="screen-grid lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="scroll-pane">
          {feed.ok ? (
            <FeedExperience
              initialContentPreference={preferences.ok ? preferences.data.nsfwPreference : "both"}
              initialPage={feed.data}
              surface="home"
            />
          ) : (
            <ErrorState result={feed} title="Feed needs your session" context="Home feed" />
          )}
        </div>

        <aside className="scroll-pane">
          <Card className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="eyebrow">Live rail</p>
                <h2 className="mt-1 text-lg font-semibold tracking-normal">Event Access</h2>
              </div>
              <StatusPill>Backend truth</StatusPill>
            </div>
          </Card>

          {discover.ok ? (
            liveRooms.length > 0 ? (
              liveRooms.map((room) => <LiveRoomRailCard room={room} key={room.id} />)
            ) : (
              <EmptyState title="No live rooms right now">
                Live rooms appear here only after the backend exposes a viewable room.
              </EmptyState>
            )
          ) : (
            <ErrorState result={discover} title="Live rail needs your session" context="Live rail" />
          )}
        </aside>
      </section>
    </AppShell>
  );
}

function LiveRoomRailCard({ room }: { room: LiveRoom }) {
  return (
    <Card className="overflow-hidden">
      <div className="aspect-video bg-(--panel-strong) p-4">
        <div className="flex h-full flex-col justify-between rounded border border-(--line) bg-(--glass) p-3">
          <StatusPill tone={room.state === "live" ? "good" : "warn"}>{room.state}</StatusPill>
          <div>
            <p className="font-semibold">{room.title}</p>
            <p className="mt-1 text-sm text-(--text-soft)">@{room.creator.handle}</p>
          </div>
        </div>
      </div>
      <div className="grid gap-3 p-4 text-sm">
        <Fact
          label="Access"
          value={
            room.eventAccess
              ? formatAssetAmount(room.eventAccess.amountMinor, room.eventAccess.currency)
              : room.accessMode
          }
        />
        <Fact label="Playback" value={room.playback?.state ?? "not ready"} />
        <Fact label="Chat" value={room.chat.accessState} />
      </div>
    </Card>
  );
}
