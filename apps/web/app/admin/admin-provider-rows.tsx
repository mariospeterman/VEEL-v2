import type {
  AdminAgeCheck,
  AdminAiSession,
  AdminAiToolCall,
  AdminIdentityCheck,
  AdminLiveRoom,
  AdminMediaAsset,
  AdminProviderEvent
} from "@/api-client";
import {
  Fact,
  formatDate,
  timestampLabel
} from "./admin-ui";
import { retryProviderEventReplayAction, updateLiveRoomSuspensionAction } from "./actions";

export function ProviderEventRow({ event }: { event: AdminProviderEvent }) {
  return (
    <article className="rounded border border-(--line) bg-(--background) p-3 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{event.provider}</p>
          <p className="mt-1 truncate text-(--muted)">{event.eventType}</p>
        </div>
        <span className="rounded bg-(--accent-soft) px-2 py-1 text-xs font-medium text-(--accent-strong)">
          {event.state}
        </span>
      </div>
      <div className="mt-3 grid gap-2">
        <Fact label="Received" value={formatDate(event.receivedAt)} />
        <Fact label="Processed" value={formatDate(event.processedAt ?? null)} />
        <Fact label="Replay" value={event.latestReplayState ?? "none"} />
        <Fact label="Replay failure" value={event.latestReplayFailureCode ?? "none"} />
        <Fact label="Replay processed" value={formatDate(event.latestReplayProcessedAt ?? null)} />
      </div>
      {event.latestReplayState === "dead_letter" && event.latestReplayRequestId ? (
        <form action={retryProviderEventReplayAction} className="mt-3 grid gap-2 border-t border-(--line) pt-3 sm:grid-cols-[1fr_auto]">
          <input name="replayRequestId" type="hidden" value={event.latestReplayRequestId} />
          <label className="grid gap-1 text-xs text-(--muted)">
            <span>Recovery reason</span>
            <input className="min-h-10 rounded border border-(--line) bg-(--panel) px-3 text-(--foreground)" maxLength={1000} name="reason" required />
          </label>
          <button className="min-h-10 self-end rounded border border-(--line) px-3 font-semibold" type="submit">Retry replay</button>
        </form>
      ) : null}
    </article>
  );
}

export function LiveProviderRow({ room }: { room: AdminLiveRoom }) {
  return (
    <article className="rounded border border-(--line) bg-(--background) p-3 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{room.title}</p>
          <p className="mt-1 truncate text-(--muted)">{room.providerStreamId ?? room.provider}</p>
        </div>
        <span className="rounded bg-(--accent-soft) px-2 py-1 text-xs font-medium text-(--accent-strong)">
          {room.state}
        </span>
      </div>
      <div className="mt-3 grid gap-2">
        <Fact label="Provider" value={room.providerState} />
        <Fact label="Playback URL" value={room.hasPlaybackUrl ? "present" : "none"} />
        <Fact label="Stream key" value={room.hasHostStreamKey ? "redacted" : "none"} />
      </div>
      <form action={updateLiveRoomSuspensionAction} className="mt-3 grid gap-2 border-t border-(--line) pt-3 sm:grid-cols-[120px_1fr_auto]">
        <input name="roomId" type="hidden" value={room.id} />
        <label className="grid gap-1 text-xs text-(--muted)">
          <span>Action</span>
          <select className="min-h-10 rounded border border-(--line) bg-(--panel) px-2 text-(--foreground)" defaultValue={room.state === "suspended" ? "false" : "true"} name="suspended">
            <option value="true">Suspend</option>
            <option value="false">Resume</option>
          </select>
        </label>
        <label className="grid gap-1 text-xs text-(--muted)">
          <span>Safety reason</span>
          <input className="min-h-10 rounded border border-(--line) bg-(--panel) px-3 text-(--foreground)" maxLength={1000} name="reason" required />
        </label>
        <button className="min-h-10 self-end rounded border border-(--line) px-3 font-semibold" type="submit">Apply</button>
      </form>
    </article>
  );
}

export function MediaProviderRow({ asset }: { asset: AdminMediaAsset }) {
  return (
    <article className="rounded border border-(--line) bg-(--background) p-3 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{asset.provider}</p>
          <p className="mt-1 truncate text-(--muted)">{asset.providerAssetId}</p>
        </div>
        <span className="rounded bg-(--accent-soft) px-2 py-1 text-xs font-medium text-(--accent-strong)">
          {asset.providerState}
        </span>
      </div>
      <div className="mt-3 grid gap-2">
        <Fact label="Playable" value={asset.providerPlayable ? "yes" : "no"} />
        <Fact label="Playback URL" value={asset.hasPlaybackUrl ? "present" : "none"} />
        <Fact label="Checked" value={timestampLabel(asset.providerCheckedAt ?? null)} />
      </div>
    </article>
  );
}

export function AgeCheckRow({ check }: { check: AdminAgeCheck }) {
  return (
    <article className="rounded border border-(--line) bg-(--background) p-3 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">Age assurance</p>
          <p className="mt-1 truncate text-(--muted)">{check.provider}</p>
        </div>
        <span className="rounded bg-(--accent-soft) px-2 py-1 text-xs font-medium text-(--accent-strong)">
          {check.state}
        </span>
      </div>
      <div className="mt-3 grid gap-2">
        <Fact label="Jurisdiction" value={check.jurisdiction ?? "unknown"} />
        <Fact label="Provider ref" value={check.hasProviderReference ? "present" : "none"} />
        <Fact label="Boundary" value="no raw identity" />
      </div>
    </article>
  );
}

export function IdentityCheckRow({ check }: { check: AdminIdentityCheck }) {
  return (
    <article className="rounded border border-(--line) bg-(--background) p-3 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{check.verificationType.toUpperCase()}</p>
          <p className="mt-1 truncate text-(--muted)">{check.provider}</p>
        </div>
        <span className="rounded bg-(--accent-soft) px-2 py-1 text-xs font-medium text-(--accent-strong)">
          {check.state}
        </span>
      </div>
      <div className="mt-3 grid gap-2">
        <Fact label="Country" value={check.countryCode ?? "unknown"} />
        <Fact label="Legal name" value={check.hasLegalNameHash ? "hashed" : "none"} />
        <Fact label="Boundary" value="no raw documents" />
      </div>
    </article>
  );
}

export function AiSessionRow({ session }: { session: AdminAiSession }) {
  return (
    <article className="rounded border border-(--line) bg-(--background) p-3 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{session.scope}</p>
          <p className="mt-1 truncate text-(--muted)">{session.actorUserId}</p>
        </div>
        <span className="rounded bg-(--accent-soft) px-2 py-1 text-xs font-medium text-(--accent-strong)">
          {session.state}
        </span>
      </div>
      <div className="mt-3 grid gap-2">
        <Fact label="Tools" value={session.allowedToolCount.toString()} />
        <Fact label="Expires" value={timestampLabel(session.expiresAt)} />
      </div>
    </article>
  );
}

export function AiToolCallRow({ toolCall }: { toolCall: AdminAiToolCall }) {
  return (
    <article className="rounded border border-(--line) bg-(--background) p-3 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{toolCall.toolName}</p>
          <p className="mt-1 truncate text-(--muted)">{toolCall.inputSummary}</p>
        </div>
        <span className="rounded bg-(--accent-soft) px-2 py-1 text-xs font-medium text-(--accent-strong)">
          {toolCall.state}
        </span>
      </div>
      <div className="mt-3 grid gap-2">
        <Fact label="Confirm" value={toolCall.confirmationState} />
        <Fact label="Subject" value={toolCall.subjectType ?? "none"} />
        <Fact label="Boundary" value="summaries only" />
      </div>
    </article>
  );
}
