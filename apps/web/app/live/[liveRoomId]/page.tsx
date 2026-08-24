import { appShellNavItems } from "@veel/ui";
import { getLiveRoom, getLiveRoomMessages, type LiveChatPage, type LiveRoom } from "@/api-client";
import { ProviderPlayback } from "../../provider-playback";
import { ErrorState } from "../../ui";
import { LiveAccessPanel as LiveAccessOfferPanel } from "./live-access-panel";
import { LiveInteractionPanel } from "./live-interaction-panel";

export default async function LiveRoomPage({
  params
}: {
  params: Promise<{ liveRoomId: string }>;
}) {
  const { liveRoomId } = await params;
  const roomResult = await getLiveRoom(liveRoomId);
  const messagesResult = roomResult.ok
    ? await getLiveRoomMessages(liveRoomId)
    : { ok: false as const, status: 404, message: "Live room unavailable" };

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
            <LiveAccessPanel initialMessages={messagesResult.ok ? messagesResult.data : { items: [] }} room={roomResult.data} />
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
      <ProviderPlayback playback={room.playback} title={`${room.title} live playback`} />
      <div className="absolute left-4 top-4 flex items-center gap-2">
        <span className="rounded bg-[#fee2e2] px-2 py-1 text-xs font-semibold uppercase text-[#991b1b]">
          {roomStateLabel(room.state)}
        </span>
      </div>
      <div className="absolute inset-x-0 bottom-0 p-5">
        <p className="text-sm font-medium text-(--accent-text)">@{room.creator.handle}</p>
        <h1 className="mt-2 max-w-3xl text-2xl font-semibold tracking-normal">{room.title}</h1>
      </div>
    </section>
  );
}

function LiveAccessPanel({ initialMessages, room }: { initialMessages: LiveChatPage; room: LiveRoom }) {
  return (
    <aside className="side-pane grid content-start gap-4">
      <section className="rounded border border-(--line) bg-(--panel) p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{room.creator.displayName || `@${room.creator.handle}`}</p>
            <p className="text-sm text-(--muted)">@{room.creator.handle}</p>
          </div>
          <span className="rounded bg-(--accent-soft) px-2 py-1 text-xs font-medium text-(--accent-strong)">{liveAccessLabel(room)}</span>
        </div>

        <div className="mt-5 grid gap-3 border-t border-(--line) pt-4">
          <Fact label="Watch" value={liveAccessLabel(room)} />
          <Fact label="Audience" value={audienceLabel(room.accessMode)} />
          {room.accessMode === "paid_event" ? <Fact label="Preview" value={`${room.previewSecondsRemaining ?? 0}s remaining`} /> : null}
          <Fact label="Chat" value={chatLabel(room)} />
          {room.safetyState === "suspended" || room.safetyState === "rejected" || room.safetyState === "quarantined" ? <Fact label="Availability" value="Safety review in progress" /> : null}
        </div>
      </section>

      <LiveAccessOfferPanel room={room} />

      <LiveInteractionPanel initialMessages={initialMessages} room={room} />
    </aside>
  );
}

function roomStateLabel(state: LiveRoom["state"]) {
  if (state === "scheduled") return "Upcoming";
  if (state === "waiting") return "Starting soon";
  if (state === "live") return "Live";
  if (state === "replay_ready") return "Replay";
  if (state === "suspended") return "Paused";
  return "Ended";
}

function liveAccessLabel(room: LiveRoom) {
  if (room.accessState === "allowed") return "Ready to watch";
  return room.accessState === "membership_required" ? "Membership required" : "Event Access required";
}

function audienceLabel(mode: LiveRoom["accessMode"]) {
  if (mode === "public") return "Everyone";
  if (mode === "profile_members") return "Members";
  return "Event guests";
}

function chatLabel(room: LiveRoom) {
  if (!room.chat.enabled || room.chat.accessState === "closed") return "Closed";
  if (room.chat.accessState === "members_only") return "Members only";
  return "Open";
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-(--muted)">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}
