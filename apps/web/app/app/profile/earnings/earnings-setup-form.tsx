"use client";

import { useState } from "react";
import type { CreatorOnboarding, Wallet } from "@/api-client";
import {
  ApiMutationError,
  createVerificationSession,
  updateMyCreatorOnboarding,
  type UpdateCreatorOnboardingRequest
} from "@/api-mutations";
import { Card, StatusPill } from "../../../ui";

type ProductSelection = UpdateCreatorOnboardingRequest["products"];

const productOptions: Array<[keyof ProductSelection, string, string]> = [
  ["support", "Support", "Let viewers send a one-time contribution."],
  ["contentUnlocks", "Content unlocks", "Sell access to an individual post."],
  ["eventAccessAndLive", "Event Access + paid live", "Sell time-bound access without selling social priority."],
  ["paidMessages", "Creator requests", "Offer approved media or accept a defined deliverable without selling attention."],
  ["memberships", "Memberships", "Offer one recurring plan from your profile."]
];

export function EarningsSetupForm({
  wallets,
  initialOnboarding
}: {
  wallets: Wallet[];
  initialOnboarding: CreatorOnboarding;
}) {
  const primaryWallet = wallets.find((wallet) => wallet.isPrimary) ?? wallets[0];
  const configuredWallet = wallets.find(
    (wallet) => wallet.id === initialOnboarding.configuration.recipientWalletId
  );
  const [walletId, setWalletId] = useState(configuredWallet?.id ?? primaryWallet?.id ?? "");
  const [products, setProducts] = useState(initialOnboarding.configuration.products);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [onboarding, setOnboarding] = useState(initialOnboarding);
  const [pending, setPending] = useState<"save" | "kyc" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const kycStep = onboarding.steps.find((step) => step.key === "kyc");
  const taxStep = onboarding.steps.find((step) => step.key === "tax_profile");
  const canSave = Boolean(walletId && termsAccepted && Object.values(products).some(Boolean));

  async function save() {
    if (!canSave) return;
    setPending("save");
    setMessage(null);
    try {
      const updated = await updateMyCreatorOnboarding({
        recipientWalletId: walletId,
        earningsTermsVersion: "wevid-creator-earnings-v1",
        earningsTermsAccepted: true,
        products
      });
      setOnboarding(updated);
      setTermsAccepted(false);
      setMessage(
        updated.canStartEarning
          ? "Earnings are enabled. Purchases count only after payment confirmation."
          : "Saved. Complete the remaining required check shown above."
      );
    } catch (error) {
      setMessage(error instanceof ApiMutationError ? error.message : "Earnings setup could not be saved.");
    } finally {
      setPending(null);
    }
  }

  async function startCreatorVerification() {
    setPending("kyc");
    setMessage(null);
    try {
      const session = await createVerificationSession({
        purpose: "creator_kyc",
        providerPreference: "provider_first",
        source: "earnings",
        adultPublisherTermsAccepted: false
      });
      window.location.assign(session.launchUrl);
    } catch (error) {
      setMessage(error instanceof ApiMutationError ? error.message : "Creator verification could not start.");
      setPending(null);
    }
  }

  return (
    <Card className="grid gap-6 p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold">Earnings configuration</h2>
          <p className="mt-1 text-sm leading-6 text-(--muted)">
            Choose where creator proceeds go and what viewers may buy. WeVid never holds a creator balance.
          </p>
        </div>
        <StatusPill tone={onboarding.canStartEarning ? "good" : "warn"}>
          {onboarding.canStartEarning ? "enabled" : "setup"}
        </StatusPill>
      </div>

      <fieldset className="grid gap-2" id="earnings-wallet">
        <legend className="text-sm font-semibold">Recipient wallet</legend>
        {wallets.length > 0 ? (
          <select
            aria-label="Recipient wallet"
            className="min-h-11 rounded border border-(--line) bg-(--background) px-3 text-sm"
            onChange={(event) => setWalletId(event.target.value)}
            value={walletId}
          >
            {wallets.map((wallet) => (
              <option key={wallet.id} value={wallet.id}>
                {wallet.address.slice(0, 6)}…{wallet.address.slice(-6)} · {wallet.chain}{wallet.isPrimary ? " · primary" : ""}
              </option>
            ))}
          </select>
        ) : (
          <a className="primary-button w-fit" href="/?mode=onboarding&step=wallet&next=%2Fapp%2Fprofile%2Fearnings">
            Connect a wallet
          </a>
        )}
      </fieldset>

      <fieldset className="grid gap-2" id="products">
        <legend className="text-sm font-semibold">One-time products</legend>
        {productOptions.map(([key, label, description]) => (
          <label className="flex min-h-14 items-center justify-between gap-4 rounded border border-(--line) bg-(--background) px-3 py-2" key={key}>
            <span>
              <span className="block text-sm font-medium">{label}</span>
              <span className="block text-xs text-(--muted)">{description}</span>
            </span>
            <input
              checked={products[key]}
              className="size-4 shrink-0 accent-(--accent)"
              onChange={(event) => setProducts((current) => ({ ...current, [key]: event.target.checked }))}
              type="checkbox"
            />
          </label>
        ))}
      </fieldset>

      {kycStep?.required ? (
        <div className="rounded border border-(--line) p-3" id="creator-verification">
          <p className="text-sm font-semibold">Creator verification</p>
          <p className="mt-1 text-sm text-(--muted)">
            Current policy: {kycStep.state.replaceAll("_", " ")}. The configured identity provider opens only when required.
          </p>
          {kycStep.state === "action_required" || kycStep.state === "blocked" ? (
            <button className="secondary-button mt-3" disabled={pending !== null} onClick={() => void startCreatorVerification()} type="button">
              {pending === "kyc" ? "Opening verification" : "Start creator verification"}
            </button>
          ) : null}
        </div>
      ) : null}

      {taxStep?.required ? (
        <div className="rounded border border-(--line) p-3" id="tax-profile">
          <p className="text-sm font-semibold">Tax profile</p>
          <p className="mt-1 text-sm leading-6 text-(--muted)">
            Current state: {taxStep.state.replaceAll("_", " ")}. Earnings remain closed until the configured compliance provider or staff review records tax readiness; WeVid does not infer this in the browser.
          </p>
        </div>
      ) : null}

      <label className="flex items-start gap-2 text-sm text-(--muted)">
        <input
          checked={termsAccepted}
          className="mt-1 size-4 accent-(--accent)"
          onChange={(event) => setTermsAccepted(event.target.checked)}
          type="checkbox"
        />
        <span>
          I accept the Creator Earnings Terms. Proceeds settle directly to the selected wallet; WeVid records receipts and access, not a withdrawable balance.
        </span>
      </label>

      <button className="primary-button w-fit" disabled={!canSave || pending !== null} onClick={() => void save()} type="button">
        {pending === "save" ? "Saving" : onboarding.canStartEarning ? "Update earnings" : "Enable earnings"}
      </button>
      {message ? <p aria-live="polite" className="text-sm text-(--muted)">{message}</p> : null}
    </Card>
  );
}
