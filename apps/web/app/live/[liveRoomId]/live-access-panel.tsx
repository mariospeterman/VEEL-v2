"use client";

import { useRouter } from "next/navigation";
import type { LiveRoom } from "@/api-client";
import { createLiveEventAccessIntent } from "@/api-mutations";
import { PaymentHandoffPanel } from "@/payment-handoff-panel";
import { formatAtomicAssetAmount } from "@/format-asset-amount";

export function LiveAccessPanel({ room }: { room: LiveRoom }) {
  const router = useRouter();

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

  if (room.accessState === "allowed") {
    return (
      <AccessSummary title="Event access ready">
        Your confirmed event access includes this live and its replay window.
      </AccessSummary>
    );
  }

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
          {formatAtomicAssetAmount(offer.amountMinor, offer.currency)}
        </span>
      </div>
      {offer.membersIncluded ? (
        <p className="mt-3 text-sm text-(--muted)">Active profile members are included.</p>
      ) : null}
      <div className="mt-4">
        <PaymentHandoffPanel
          createIntent={(idempotencyKey) => createLiveEventAccessIntent(room.id, idempotencyKey)}
          ctaLabel="Get event access"
          idleCopy="Review the exact event price, then approve the request in your wallet. Access appears after payment confirmation."
          onConfirmed={() => router.refresh()}
          pendingLabel="Creating event access"
          readyCopy="Open the wallet request. Your confirmed access will appear automatically."
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
