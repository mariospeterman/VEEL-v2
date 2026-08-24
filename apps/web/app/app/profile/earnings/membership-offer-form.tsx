"use client";

import { useState } from "react";
import type { SubscriptionPlan } from "@/api-client";
import {
  ApiMutationError,
  disableCreatorMembershipOffer,
  upsertCreatorMembershipOffer
} from "@/api-mutations";
import { Card, StatusPill } from "../../../ui";

export function MembershipOfferForm({ initialOffer }: { initialOffer: SubscriptionPlan | null }) {
  const [offer, setOffer] = useState(initialOffer);
  const [label, setLabel] = useState(initialOffer?.label ?? "Monthly membership");
  const [description, setDescription] = useState(initialOffer?.description ?? "");
  const [price, setPrice] = useState(((initialOffer?.amountMinor ?? 1000) / 100).toFixed(2));
  const [benefits, setBenefits] = useState((initialOffer?.benefits ?? []).join("\n"));
  const [pending, setPending] = useState<"save" | "disable" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function save() {
    setPending("save");
    setMessage(null);
    try {
      const amountMinor = Math.round(Number(price) * 100);
      const updated = await upsertCreatorMembershipOffer({
        label,
        amountMinor,
        description: description.trim() || null,
        benefits: benefits.split("\n").map((benefit) => benefit.trim()).filter(Boolean).slice(0, 8)
      });
      setOffer(updated);
      setMessage("Offer saved. New joins remain closed until recurring payments pass staging proof.");
    } catch (error) {
      setMessage(error instanceof ApiMutationError ? error.message : "Membership offer could not be saved.");
    } finally {
      setPending(null);
    }
  }

  async function disable() {
    setPending("disable");
    setMessage(null);
    try {
      await disableCreatorMembershipOffer();
      setOffer((current) => current ? { ...current, providerState: "staging_required" } : current);
      setMessage("Offer disabled for new joins. Existing paid periods are unchanged.");
    } catch (error) {
      setMessage(error instanceof ApiMutationError ? error.message : "Membership offer could not be disabled.");
    } finally {
      setPending(null);
    }
  }

  return (
    <Card className="grid gap-5 p-4" id="membership-offer">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold">Profile membership</h2>
          <p className="mt-1 text-sm leading-6 text-(--muted)">
            One simple recurring offer appears directly on your profile. Payments go to your selected wallet.
          </p>
        </div>
        <StatusPill tone={offer?.providerState === "launch_approved" ? "good" : "warn"}>
          {offer?.providerState === "launch_approved" ? "available" : offer ? "coming soon" : "draft"}
        </StatusPill>
      </div>
      <label className="grid gap-1 text-sm">
        <span className="font-medium">Name</span>
        <input className="min-h-11 rounded border border-(--line) bg-(--background) px-3" maxLength={80} onChange={(event) => setLabel(event.target.value)} value={label} />
      </label>
      <label className="grid gap-1 text-sm">
        <span className="font-medium">Monthly price (USDC)</span>
        <input className="min-h-11 rounded border border-(--line) bg-(--background) px-3" min="1" max="1000" onChange={(event) => setPrice(event.target.value)} step="0.01" type="number" value={price} />
      </label>
      <label className="grid gap-1 text-sm">
        <span className="font-medium">Description</span>
        <textarea className="min-h-24 rounded border border-(--line) bg-(--background) p-3" maxLength={500} onChange={(event) => setDescription(event.target.value)} value={description} />
      </label>
      <label className="grid gap-1 text-sm">
        <span className="font-medium">Benefits</span>
        <textarea className="min-h-28 rounded border border-(--line) bg-(--background) p-3" onChange={(event) => setBenefits(event.target.value)} placeholder="One benefit per line" value={benefits} />
      </label>
      <div className="flex flex-wrap gap-2">
        <button className="primary-button" disabled={pending !== null || label.trim().length < 2 || !Number.isFinite(Number(price))} onClick={() => void save()} type="button">
          {pending === "save" ? "Saving" : offer ? "Update membership" : "Create membership"}
        </button>
        {offer ? (
          <button className="secondary-button" disabled={pending !== null} onClick={() => void disable()} type="button">
            {pending === "disable" ? "Disabling" : "Disable new joins"}
          </button>
        ) : null}
      </div>
      {message ? <p aria-live="polite" className="text-sm text-(--muted)">{message}</p> : null}
    </Card>
  );
}
