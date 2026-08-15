"use client";

import type { LiveRoom } from "@/api-client";
import { createLiveEventAccessIntent } from "@/api-mutations";
import { PaymentHandoffPanel } from "@/payment-handoff-panel";
import { formatAssetAmount } from "@/format-asset-amount";

export function LiveAccessPanel({ room }: { room: LiveRoom }) {
  if (room.accessMode === "public") {
    return (
      <AccessSummary title="Public live">
        Everyone can watch. The host can still offer Support or profile membership.
      </AccessSummary>
    );
  }

  if (room.accessMode === "profile_members") {
    return (
      <AccessSummary title="Members live">
        {room.accessState === "allowed"
          ? "Your profile membership includes this live and its replay."
          : `Join @${room.creator.handle} to watch this live and its replay.`}
      </AccessSummary>
    );
  }

  const offer = room.eventAccess;

  if (!offer) {
    return <AccessSummary title="Paid event">Event access is not currently on sale.</AccessSummary>;
  }

  return (
    <section className="rounded border border-(--line) bg-(--panel) p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Event access</h2>
          <p className="mt-1 text-sm text-(--muted)">
            Live plus {offer.replayWindowHours}h replay access
          </p>
        </div>
        <span className="text-sm font-semibold">
          {formatAssetAmount(offer.amountMinor, offer.currency)}
        </span>
      </div>
      {offer.membersIncluded ? (
        <p className="mt-3 text-sm text-(--muted)">Active profile members are included.</p>
      ) : null}
      <div className="mt-4">
        <PaymentHandoffPanel
          createIntent={(idempotencyKey) => createLiveEventAccessIntent(room.id, idempotencyKey)}
          ctaLabel="Get event access"
          disabled={room.accessState === "allowed"}
          idleCopy="The backend creates one server-priced wallet request. Access changes only after settlement verification."
          pendingLabel="Creating event access"
          readyCopy="Open the wallet request. Access updates after backend settlement verification."
        />
      </div>
    </section>
  );
}

function AccessSummary({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <section className="rounded border border-(--line) bg-(--panel) p-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-(--muted)">{children}</p>
    </section>
  );
}
