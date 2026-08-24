import {
  getDiscoverSearch,
  getFeedPreferences,
  getHomeFeed,
  type LiveRoom
} from "@/api-client";
import { requireAppAccess } from "@/supabase/route-guard";
import { AppShell } from "../../app-shell";
import { Card, EmptyState, ErrorState } from "../../ui";
import { FeedExperience } from "../feed-experience";
import { MomentTray } from "../moments/moment-tray";

export const dynamic = "force-dynamic";

export default async function AppHomePage() {
  await requireAppAccess("/app/home");

  const preferences = await getFeedPreferences();
  const initialMode = preferences.ok ? preferences.data.defaultMode : "recommended";
  const [feed, moments, discover] = await Promise.all([
    getHomeFeed(initialMode, "home"),
    getHomeFeed(initialMode, "moments"),
    getDiscoverSearch("")
  ]);
  const liveRooms = discover.ok ? discover.data.liveRooms.slice(0, 3) : [];

  return (
    <AppShell>
      {moments.ok ? <MomentTray items={moments.data.items} liveRooms={liveRooms} /> : null}

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

        <aside className="scroll-pane hidden lg:grid">
          <Card className="p-4"><p className="eyebrow">Happening now</p><h2 className="mt-1 text-lg font-semibold tracking-normal">Live and upcoming</h2></Card>

          {discover.ok ? (
            liveRooms.length > 0 ? (
              liveRooms.map((room) => <LiveRoomRailCard room={room} key={room.id} />)
            ) : (
              <EmptyState title="No live rooms right now">
                Check back soon, or explore creators and recent posts.
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
      <a className="block aspect-video bg-(--panel-strong) p-4" href={`/live/${room.id}`}>
        <div className="flex h-full flex-col justify-between rounded border border-(--line) bg-(--glass) p-3">
          <span className="w-fit rounded-full bg-(--background) px-3 py-1 text-xs font-semibold">{room.state === "live" ? "Live now" : "Replay"}</span>
          <div>
            <p className="font-semibold">{room.title}</p>
            <p className="mt-1 text-sm text-(--text-soft)">@{room.creator.handle}</p>
          </div>
        </div>
      </a>
      <div className="p-4 text-sm text-(--muted)">{liveAccessLabel(room)}</div>
    </Card>
  );
}

function liveAccessLabel(room: LiveRoom) {
  if (room.eventAccess) return "Event Access available";
  if (room.accessMode === "profile_members") return "For members";
  return "Open to everyone";
}
