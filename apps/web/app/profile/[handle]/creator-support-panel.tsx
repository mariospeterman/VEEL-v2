"use client";

import { useState } from "react";
import type { CreatorProfile } from "@/api-client";
import { createPaymentIntent } from "@/api-mutations";
import { formatAssetAmount } from "@/format-asset-amount";
import { PaymentHandoffPanel } from "@/payment-handoff-panel";

interface CreatorSupportPanelProps {
  profile: CreatorProfile;
}

const supportPresets = [500_000, 1_000_000, 2_000_000, 5_000_000] as const;

export function CreatorSupportPanel({ profile }: CreatorSupportPanelProps) {
  const [amountMinor, setAmountMinor] = useState<number>(supportPresets[1]);
  const supportEnabled = profile.monetisation.supportEnabled;

  return (
    <section className="rounded border border-(--line) bg-(--panel) p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Support</h2>
          <p className="mt-1 text-sm text-(--muted)">Voluntary creator support</p>
        </div>
        <span className="rounded bg-(--accent-soft) px-2 py-1 text-xs font-medium text-(--accent-strong)">{supportEnabled ? "Available" : "Coming soon"}</span>
      </div>

      <div className="mt-4 grid gap-3 border-t border-(--line) pt-4">
        <div className="grid grid-cols-4 gap-2">
          {supportPresets.map((preset) => (
            <button
              className={`rounded border px-2 py-2 text-sm ${
                amountMinor === preset
                  ? "border-(--accent) bg-(--accent-soft) text-(--accent-strong)"
                  : "border-(--line) text-(--foreground)"
              }`}
              disabled={!supportEnabled}
              key={preset}
              onClick={() => setAmountMinor(preset)}
              type="button"
            >
              {formatAssetAmount(preset, "USDC")}
            </button>
          ))}
        </div>

        <PaymentHandoffPanel
          createIntent={(idempotencyKey) =>
            createPaymentIntent({
              amountMinor,
              currency: "USDC",
              productType: "support",
              targetId: profile.user.id
            }, idempotencyKey)
          }
          ctaLabel="Support creator"
          disabled={!supportEnabled}
          idleCopy="Support is a voluntary payment. It does not buy visibility, access to people, recommendations, or message priority."
          pendingLabel="Creating support intent"
          readyCopy="Open the wallet request. Support is recorded after payment confirmation."
        />
      </div>
    </section>
  );
}
