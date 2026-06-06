import type { components } from "@veel/contracts";
import { appShellNavItems } from "@veel/ui";

type LiveRoom = components["schemas"]["LiveRoom"];

const sampleRoom: LiveRoom = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa10",
  title: "Friday live studio",
  creator: {
    id: "00000000-0000-4000-8000-000000000010",
    handle: "maki",
    displayName: "Maki",
    avatarUrl: null,
    badges: []
  },
  state: "live",
  accessState: "pass_required",
  playback: {
    state: "blocked",
    url: null,
    provider: "livepeer"
  },
  teaserSecondsRemaining: 45,
  passOptions: [
    { durationMinutes: 30, amountMinor: 50000000, currency: "SOL" },
    { durationMinutes: 60, amountMinor: 90000000, currency: "SOL" },
    { durationMinutes: 180, amountMinor: 220000000, currency: "SOL" }
  ],
  chat: {
    enabled: true,
    accessState: "pass_required"
  },
  replayContentId: null
};

export default async function LiveRoomPage({
  params
}: {
  params: Promise<{ liveRoomId: string }>;
}) {
  const { liveRoomId } = await params;
  const room = {
    ...sampleRoom,
    id: liveRoomId
  };

  return (
    <main className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <nav className="mx-auto flex w-full max-w-7xl items-center justify-between border-b border-[var(--line)] px-5 py-4">
        <a className="text-lg font-semibold tracking-normal" href="/">
          VEEL
        </a>
        <div className="flex gap-1">
          {appShellNavItems.map((item) => (
            <a
              className="rounded px-3 py-2 text-sm text-[var(--muted)] transition hover:bg-[var(--panel)] hover:text-[var(--foreground)]"
              href={item.href}
              key={item.href}
            >
              {item.label}
            </a>
          ))}
        </div>
      </nav>

      <section className="mx-auto grid min-h-[calc(100vh-73px)] w-full max-w-7xl gap-5 px-5 py-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <LiveStage room={room} />
        <LiveAccessPanel room={room} />
      </section>
    </main>
  );
}

function LiveStage({ room }: { room: LiveRoom }) {
  return (
    <section className="relative min-h-[68vh] overflow-hidden rounded border border-[var(--line)] bg-[#0f1217]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(20,184,166,0.25),transparent_32%),linear-gradient(135deg,#101827,#09090b_55%,#172554)]" />
      <div className="absolute left-4 top-4 flex items-center gap-2">
        <span className="rounded bg-[#fee2e2] px-2 py-1 text-xs font-semibold uppercase text-[#991b1b]">
          {room.state}
        </span>
        <span className="rounded bg-white/10 px-2 py-1 text-xs font-medium text-white">
          Livepeer
        </span>
      </div>
      <div className="absolute inset-x-0 bottom-0 p-5">
        <p className="text-sm font-medium text-[var(--accent)]">@{room.creator.handle}</p>
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
    <aside className="grid content-start gap-4">
      <section className="rounded border border-[var(--line)] bg-[var(--panel)] p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{room.creator.displayName}</p>
            <p className="text-sm text-[var(--muted)]">@{room.creator.handle}</p>
          </div>
          <span className="rounded bg-[var(--accent-soft)] px-2 py-1 text-xs font-medium uppercase text-[var(--accent-strong)]">
            {room.accessState}
          </span>
        </div>

        <div className="mt-5 grid gap-3 border-t border-[var(--line)] pt-4">
          <Fact label="Playback" value={room.playback?.state ?? "not_ready"} />
          <Fact label="Provider" value={room.playback?.provider ?? "none"} />
          <Fact label="Teaser" value={`${room.teaserSecondsRemaining ?? 0}s remaining`} />
          <Fact label="Chat" value={room.chat.accessState} />
        </div>
      </section>

      <section className="rounded border border-[var(--line)] bg-[var(--panel)] p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">Pass options</h2>
          <span className="rounded bg-[var(--accent-soft)] px-2 py-1 text-xs font-medium text-[var(--accent-strong)]">
            server-priced
          </span>
        </div>
        <div className="mt-4 grid gap-2">
          {room.passOptions.map((option) => (
            <button
              className="flex items-center justify-between gap-3 rounded border border-[var(--line)] px-3 py-3 text-sm transition hover:bg-[var(--background)]"
              key={option.durationMinutes}
              type="button"
            >
              <span>{option.durationMinutes} minutes</span>
              <span>{option.amountMinor.toLocaleString()} {option.currency}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="rounded border border-[var(--line)] bg-[var(--panel)] p-4">
        <h2 className="text-sm font-semibold">Live chat</h2>
        <div className="mt-4 rounded border border-[var(--line)] bg-[var(--background)] p-3 text-sm text-[var(--muted)]">
          Chat unlocks only after backend-confirmed live pass settlement.
        </div>
      </section>
    </aside>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-[var(--muted)]">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}
