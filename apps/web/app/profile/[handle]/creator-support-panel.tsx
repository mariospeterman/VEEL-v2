"use client";

import { useState } from "react";
import type { CreatorProfile } from "@/api-client";
import { createPaymentIntent } from "@/api-mutations";
import { PaymentHandoffPanel } from "@/payment-handoff-panel";

interface CreatorSupportPanelProps {
  profile: CreatorProfile;
}

const supportPresets = [10_000_000, 50_000_000, 100_000_000] as const;

export function CreatorSupportPanel({ profile }: CreatorSupportPanelProps) {
  const [amountMinor, setAmountMinor] = useState<number>(supportPresets[1]);
  const supportEnabled = profile.monetisation.tipsEnabled;

  return (
    <section className="rounded border border-(--line) bg-(--panel) p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Support</h2>
          <p className="mt-1 text-sm text-(--muted)">Voluntary creator support</p>
        </div>
        <span className="rounded bg-(--accent-soft) px-2 py-1 text-xs font-medium text-(--accent-strong)">
          {supportEnabled ? "enabled" : "disabled"}
        </span>
      </div>

      <div className="mt-4 grid gap-3 border-t border-(--line) pt-4">
        <div className="grid grid-cols-3 gap-2">
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
              {formatSolAmount(preset)}
            </button>
          ))}
        </div>

        <PaymentHandoffPanel
          createIntent={() =>
            createPaymentIntent({
              amountMinor,
              productType: "support",
              targetId: profile.user.id
            })
          }
          ctaLabel="Support creator"
          disabled={!supportEnabled}
          idleCopy="Support is a voluntary payment. It does not buy visibility, access to people, recommendations, or message priority."
          pendingLabel="Creating support intent"
          readyCopy="Open the wallet request. Support records become final only after backend settlement verification."
        />
      </div>
    </section>
  );
}

function formatSolAmount(lamports: number) {
  return `${lamports / 1_000_000_000} SOL`;
}
