"use client";

import type { Event } from "@/api-client";
import {
  ApiMutationError,
  createEventAccessPassIntent
} from "@/api-mutations";
import { formatAssetAmount } from "@/format-asset-amount";
import { PaymentHandoffPanel } from "@/payment-handoff-panel";

interface EventAccessPassPanelProps {
  event: Event;
}

export function EventAccessPassPanel({ event }: EventAccessPassPanelProps) {
  return (
    <section className="rounded border border-(--line) bg-(--panel) p-4">
      <h2 className="text-base font-semibold tracking-normal">Access pass sheet</h2>
      <div className="mt-4 grid gap-3">
        {event.accessPassTypes.map((accessPassType) => (
          <EventAccessPassOption event={event} key={accessPassType.id} accessPassType={accessPassType} />
        ))}
        {event.accessPassTypes.length === 0 ? (
          <p className="rounded border border-(--line) bg-(--background) p-4 text-sm text-(--muted)">
            No active pass types are available.
          </p>
        ) : null}
      </div>
    </section>
  );
}

function EventAccessPassOption({
  event,
  accessPassType
}: {
  event: Event;
  accessPassType: Event["accessPassTypes"][number];
}) {
  async function createAccessPassPayment(idempotencyKey: string) {
      const result = await createEventAccessPassIntent(event.id, {
        accessPassTypeId: accessPassType.id
      }, idempotencyKey);

      if (result.state === "approval_required" || result.state === "free_granted") return null;

      if (!result.paymentIntent) {
        throw new ApiMutationError("Access Pass checkout is unavailable.");
      }
      return result.paymentIntent;
  }

  return (
    <article className="rounded border border-(--line) bg-(--background) p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-medium">{accessPassType.label}</p>
          <p className="mt-1 text-sm text-(--muted)">{accessPassType.remaining} remaining</p>
        </div>
        <span className="rounded bg-(--accent-soft) px-2 py-1 text-xs font-medium text-(--accent-strong)">
          {accessPassType.state === "active" ? "Available" : accessPassType.state === "sold_out" ? "Sold out" : "Unavailable"}
        </span>
      </div>
      <div className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
        <Fact
          label="Price"
          value={
            accessPassType.priceMinor === null
              ? "Free"
              : formatAssetAmount(accessPassType.priceMinor, accessPassType.currency)
          }
        />
        <Fact label="Capacity" value={accessPassType.capacity.toString()} />
        <Fact label="Entry" value={event.accessRule === "private_apply" ? "Creator approval" : "Confirmed pass"} />
      </div>
      <div className="mt-4 grid gap-3 border-t border-(--line) pt-4">
        <PaymentHandoffPanel
          createIntent={createAccessPassPayment}
          ctaLabel="Get Access Pass"
          disabled={accessPassType.state !== "active" || accessPassType.remaining <= 0}
          idleCopy="Your place is held briefly while you review and approve the pass purchase."
          pendingLabel="Reserving Access Pass"
          readyCopy="Open the wallet request. Your pass appears after payment confirmation."
        />
      </div>
    </article>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs uppercase text-(--muted)">{label}</p>
      <p className="mt-1 truncate font-medium">{value}</p>
    </div>
  );
}
