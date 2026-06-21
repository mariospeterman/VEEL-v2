import { appShellNavItems } from "@veel/ui";
import { getLiveRoom, type LiveRoom } from "@/api-client";
import { ProviderPlayback } from "../../provider-playback";
import { ErrorState } from "../../ui";
import { LivePassPanel } from "./live-pass-panel";

export default async function LiveRoomPage({
  params
}: {
  params: Promise<{ liveRoomId: string }>;
}) {
  const { liveRoomId } = await params;
  const roomResult = await getLiveRoom(liveRoomId);

  return (
    <main className="media-shell">
      <nav className="media-nav">
        <a className="text-lg font-semibold tracking-normal" href="/app/home">
          WeVid
        </a>
        <div className="flex gap-1">
          {appShellNavItems.map((item) => (
            <a
              className="rounded px-3 py-2 text-sm text-(--muted) transition hover:bg-(--panel) hover:text-(--foreground)"
              href={item.href}
              key={item.href}
            >
              {item.label}
            </a>
          ))}
        </div>
      </nav>

      <section className="media-layout">
        {roomResult.ok ? (
          <>
            <LiveStage room={roomResult.data} />
            <LiveAccessPanel room={roomResult.data} />
          </>
        ) : (
          <section className="lg:col-span-2">
            <ErrorState
              context="Live room"
              result={roomResult}
              title={roomResult.status === 404 ? "Live room not found" : "Live room unavailable"}
            />
          </section>
        )}
      </section>
    </main>
  );
}

function LiveStage({ room }: { room: LiveRoom }) {
  return (
    <section className="media-pane relative overflow-hidden rounded border border-(--line) bg-[#0f1217]">
      <ProviderPlayback playback={room.playback} title="WeVid Livepeer room playback" />
      <div className="absolute left-4 top-4 flex items-center gap-2">
        <span className="rounded bg-[#fee2e2] px-2 py-1 text-xs font-semibold uppercase text-[#991b1b]">
          {room.state}
        </span>
        <span className="rounded bg-white/10 px-2 py-1 text-xs font-medium text-white">
          Livepeer
        </span>
      </div>
      <div className="absolute inset-x-0 bottom-0 p-5">
        <p className="text-sm font-medium text-(--accent)">@{room.creator.handle}</p>
        <h1 className="mt-2 max-w-3xl text-2xl font-semibold tracking-normal">Live room</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-200">{room.title}</p>
      </div>
      <div className="absolute right-4 top-4 rounded bg-black/50 px-3 py-2 text-sm text-white">
        {room.playback?.state ?? "not_ready"}
      </div>
    </section>
  );
}

function LiveAccessPanel({ room }: { room: LiveRoom }) {
  return (
    <aside className="side-pane grid content-start gap-4">
      <section className="rounded border border-(--line) bg-(--panel) p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{room.creator.displayName}</p>
            <p className="text-sm text-(--muted)">@{room.creator.handle}</p>
          </div>
          <span className="rounded bg-(--accent-soft) px-2 py-1 text-xs font-medium uppercase text-(--accent-strong)">
            {room.accessState}
          </span>
        </div>

        <div className="mt-5 grid gap-3 border-t border-(--line) pt-4">
          <Fact label="Playback" value={room.playback?.state ?? "not_ready"} />
          <Fact label="Provider" value={room.playback?.provider ?? "none"} />
          <Fact label="Teaser" value={`${room.teaserSecondsRemaining ?? 0}s remaining`} />
          <Fact label="Chat" value={room.chat.accessState} />
        </div>
      </section>

      <LivePassPanel room={room} />

      <section className="rounded border border-(--line) bg-(--panel) p-4">
        <h2 className="text-sm font-semibold">Live chat</h2>
        <div className="mt-4 rounded border border-(--line) bg-(--background) p-3 text-sm text-(--muted)">
          Chat unlocks only after backend-confirmed live pass settlement.
        </div>
      </section>
    </aside>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-(--muted)">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}
