"use client";

import type { LiveRoom } from "@/api-client";
import { createLivePassIntent } from "@/api-mutations";
import { PaymentHandoffPanel } from "@/payment-handoff-panel";

interface LivePassPanelProps {
  room: LiveRoom;
}

export function LivePassPanel({ room }: LivePassPanelProps) {
  return (
    <section className="rounded border border-(--line) bg-(--panel) p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">Pass options</h2>
        <span className="rounded bg-(--accent-soft) px-2 py-1 text-xs font-medium text-(--accent-strong)">
          server-priced
        </span>
      </div>
      <div className="mt-4 grid gap-3">
        {room.passOptions.map((option) => (
          <article
            className="grid gap-3 rounded border border-(--line) bg-(--background) p-3"
            key={option.durationMinutes}
          >
            <div className="flex items-center justify-between gap-3 text-sm">
              <span>{option.durationMinutes} minutes</span>
              <span>{option.amountMinor.toLocaleString()} {option.currency}</span>
            </div>
            <PaymentHandoffPanel
              createIntent={() =>
                createLivePassIntent(room.id, { durationMinutes: option.durationMinutes })
              }
              ctaLabel="Get live pass"
              disabled={room.accessState === "pass_active"}
              idleCopy="The API prices the pass and creates the Solana Pay request. Chat and playback access update only after backend settlement verification."
              pendingLabel="Creating pass intent"
              readyCopy="Open the wallet request. Live access changes only after backend settlement verification."
            />
          </article>
        ))}
        {room.passOptions.length === 0 ? (
          <p className="rounded border border-(--line) bg-(--background) p-3 text-sm text-(--muted)">
            No live passes are available.
          </p>
        ) : null}
      </div>
    </section>
  );
}
