"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Conversation } from "@/api-client";
import type { StructuredCreatorRequest } from "@/api-mutation-types";
import {
  createCreatorMediaOffer,
  createCreatorMediaOfferPaymentIntent,
  createStructuredCreatorRequest,
  createStructuredCreatorRequestPaymentIntent,
  getConversationCommercialInteractions,
  updateCreatorMediaOffer,
  updateStructuredCreatorRequest
} from "@/api-mutations";
import { safeMutationMessage } from "@/api-errors";
import { PaymentHandoffPanel } from "@/payment-handoff-panel";

export function CommercialInteractionsPanel({ conversation }: { conversation: Conversation }) {
  const queryClient = useQueryClient();
  const queryKey = ["messages", "conversation", conversation.id, "commercial"] as const;
  const interactions = useQuery({
    queryKey,
    queryFn: () => getConversationCommercialInteractions(conversation.id),
    enabled: conversation.requestState === "accepted"
  });
  const [status, setStatus] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey });

  if (conversation.requestState !== "accepted") return null;

  const run = async (action: () => Promise<unknown>) => {
    setStatus(null);
    try {
      await action();
      await refresh();
    } catch (error) {
      setStatus(safeMutationMessage(error, "Commercial interaction"));
    }
  };

  return (
    <details className="border-b border-(--line) bg-(--surface) px-4 py-3">
      <summary className="cursor-pointer text-sm font-semibold">Offers and creator requests</summary>
      <p className="mt-2 text-xs leading-5 text-(--muted)">
        Payment buys only the defined media or accepted deliverable. It never buys attention, replies, personal access, or priority.
      </p>
      <div className="mt-3 grid gap-3 xl:grid-cols-2">
        <MediaOfferForm conversationId={conversation.id} onCreated={refresh} onError={setStatus} />
        <CreatorRequestForm conversation={conversation} onCreated={refresh} onError={setStatus} />
      </div>
      {interactions.isLoading ? <p className="mt-3 text-sm text-(--muted)">Loading commercial workspace…</p> : null}
      <div className="mt-3 grid gap-3">
        {interactions.data?.mediaOffers.map((offer) => {
          const currentUserIsBuyer = offer.creatorUserId === conversation.counterpart.id;
          return (
            <article className="rounded border border-(--line) bg-(--background) p-3" key={offer.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div><p className="text-sm font-semibold">{offer.title}</p><p className="text-xs text-(--muted)">{offer.amountMinor} {offer.currency} · revision {offer.contentRevision} · {offer.state}</p></div>
                {offer.state === "offered" ? (
                  <button className="ghost-button" type="button" onClick={() => void run(() => updateCreatorMediaOffer(conversation.id, offer.id, currentUserIsBuyer ? "decline" : "withdraw"))}>
                    {currentUserIsBuyer ? "Decline" : "Withdraw"}
                  </button>
                ) : null}
              </div>
              {offer.description ? <p className="mt-2 text-sm text-(--muted)">{offer.description}</p> : null}
              {currentUserIsBuyer && offer.state === "offered" ? (
                <div className="mt-3">
                  <PaymentHandoffPanel
                    createIntent={(idempotencyKey) => createCreatorMediaOfferPaymentIntent(conversation.id, offer.id, idempotencyKey)}
                    ctaLabel="Unlock offered media"
                    idleCopy="Review the exact offer and approve the direct split transaction. Entitlement activates only after verified settlement."
                    pendingLabel="Preparing media offer"
                    readyCopy="The offered media becomes available after payment confirmation."
                  />
                </div>
              ) : null}
            </article>
          );
        })}
        {interactions.data?.creatorRequests.map((request) => {
          const currentUserIsCreator = request.requesterUserId === conversation.counterpart.id;
          return (
            <article className="rounded border border-(--line) bg-(--background) p-3" key={request.id}>
              <p className="text-sm font-semibold">Structured {request.permittedCategory} request</p>
              <p className="mt-1 text-sm text-(--muted)">{request.deliverable}</p>
              <p className="mt-2 text-xs text-(--muted)">{request.agreedAmountMinor ?? request.proposedAmountMinor ?? "No price proposed"} {request.currency} · {request.state}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {currentUserIsCreator && request.state === "proposed" ? <button className="ghost-button" type="button" onClick={() => void run(() => updateStructuredCreatorRequest(conversation.id, request.id, { action: "accept", ...(request.proposedAmountMinor !== undefined ? { agreedAmountMinor: request.proposedAmountMinor } : {}) }))}>Accept terms</button> : null}
                {currentUserIsCreator && ["proposed", "terms_proposed"].includes(request.state) ? <button className="ghost-button" type="button" onClick={() => void run(() => updateStructuredCreatorRequest(conversation.id, request.id, { action: "decline" }))}>Decline</button> : null}
                {!currentUserIsCreator && request.state === "terms_proposed" ? <button className="ghost-button" type="button" onClick={() => void run(() => updateStructuredCreatorRequest(conversation.id, request.id, { action: "accept_terms" }))}>Accept revised terms</button> : null}
                {currentUserIsCreator && ["active", "remediation"].includes(request.state) ? <button className="ghost-button" type="button" onClick={() => void run(() => updateStructuredCreatorRequest(conversation.id, request.id, { action: "mark_delivered" }))}>Mark delivered</button> : null}
                {!currentUserIsCreator && request.state === "delivered" ? <><button className="ghost-button" type="button" onClick={() => void run(() => updateStructuredCreatorRequest(conversation.id, request.id, { action: "complete" }))}>Complete</button><button className="ghost-button" type="button" onClick={() => void run(() => updateStructuredCreatorRequest(conversation.id, request.id, { action: "request_remediation" }))}>Request remediation</button></> : null}
              </div>
              {currentUserIsCreator && ["proposed", "terms_proposed"].includes(request.state) ? (
                <CounterTermsForm conversationId={conversation.id} request={request} run={run} />
              ) : null}
              {!currentUserIsCreator && request.state === "accepted" ? (
                <div className="mt-3">
                  <PaymentHandoffPanel
                    createIntent={(idempotencyKey) => createStructuredCreatorRequestPaymentIntent(conversation.id, request.id, idempotencyKey)}
                    ctaLabel="Fund accepted request"
                    idleCopy="Payment is available only because the creator accepted these exact terms. Delivery activates after verified settlement."
                    pendingLabel="Preparing creator request"
                    readyCopy="Verified settlement activates the delivery workspace; it does not guarantee personal attention or access."
                  />
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
      {status ? <p className="mt-3 text-sm text-(--danger)">{status}</p> : null}
    </details>
  );
}

function MediaOfferForm(input: { conversationId: string; onCreated: () => Promise<unknown>; onError: (value: string) => void }) {
  const [contentItemId, setContentItemId] = useState("");
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  return (
    <form className="grid gap-2 rounded border border-(--line) p-3" onSubmit={(event) => {
      event.preventDefault();
      void createCreatorMediaOffer(input.conversationId, {
        contentItemId,
        title,
        amountMinor: Number(amount),
        currency: "SOL",
        expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString()
      }).then(() => { setContentItemId(""); setTitle(""); setAmount(""); return input.onCreated(); }).catch((error) => input.onError(safeMutationMessage(error, "Media offer")));
    }}>
      <p className="text-sm font-semibold">Offer approved media</p>
      <input className="rounded border border-(--line) bg-(--background) p-2 text-sm" placeholder="Approved content ID" required value={contentItemId} onChange={(event) => setContentItemId(event.target.value)} />
      <input className="rounded border border-(--line) bg-(--background) p-2 text-sm" maxLength={120} placeholder="Offer title" required value={title} onChange={(event) => setTitle(event.target.value)} />
      <input className="rounded border border-(--line) bg-(--background) p-2 text-sm" min="1" placeholder="SOL atomic amount" required type="number" value={amount} onChange={(event) => setAmount(event.target.value)} />
      <button className="ghost-button" type="submit">Send media offer</button>
    </form>
  );
}

function CreatorRequestForm(input: { conversation: Conversation; onCreated: () => Promise<unknown>; onError: (value: string) => void }) {
  const [deliverable, setDeliverable] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<"photo" | "video" | "audio" | "written" | "other_safe">("video");
  const [deliveryDays, setDeliveryDays] = useState("14");
  return (
    <form className="grid gap-2 rounded border border-(--line) p-3" onSubmit={(event) => {
      event.preventDefault();
      void createStructuredCreatorRequest(input.conversation.id, {
        creatorUserId: input.conversation.counterpart.id,
        deliverable,
        permittedCategory: category,
        proposedAmountMinor: amount ? Number(amount) : null,
        currency: "SOL",
        expectedDeliveryDays: Number(deliveryDays),
        clarificationRule: "One written clarification before creator acceptance.",
        cancellationRule: "Cancellation before payment; remediation review after verified settlement.",
        expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString()
      }).then(() => { setDeliverable(""); setAmount(""); return input.onCreated(); }).catch((error) => input.onError(safeMutationMessage(error, "Creator request")));
    }}>
      <p className="text-sm font-semibold">Propose creator request</p>
      <textarea className="min-h-20 rounded border border-(--line) bg-(--background) p-2 text-sm" maxLength={1000} placeholder="Define the deliverable only—no personal or offline access." required value={deliverable} onChange={(event) => setDeliverable(event.target.value)} />
      <label className="grid gap-1 text-xs text-(--muted)">Permitted format
        <select className="rounded border border-(--line) bg-(--background) p-2 text-sm text-(--foreground)" value={category} onChange={(event) => setCategory(event.target.value as typeof category)}>
          <option value="photo">Photo</option><option value="video">Video</option><option value="audio">Audio</option><option value="written">Written</option><option value="other_safe">Other safe deliverable</option>
        </select>
      </label>
      <input className="rounded border border-(--line) bg-(--background) p-2 text-sm" min="1" placeholder="Optional SOL atomic amount" type="number" value={amount} onChange={(event) => setAmount(event.target.value)} />
      <input aria-label="Expected delivery days" className="rounded border border-(--line) bg-(--background) p-2 text-sm" max="90" min="1" required type="number" value={deliveryDays} onChange={(event) => setDeliveryDays(event.target.value)} />
      <button className="ghost-button" type="submit">Propose without paying</button>
    </form>
  );
}

function CounterTermsForm(input: {
  conversationId: string;
  request: StructuredCreatorRequest;
  run: (action: () => Promise<unknown>) => Promise<void>;
}) {
  const [amount, setAmount] = useState(String(input.request.agreedAmountMinor ?? input.request.proposedAmountMinor ?? ""));
  const [deliveryDays, setDeliveryDays] = useState(String(input.request.expectedDeliveryDays ?? 14));
  return (
    <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={(event) => {
      event.preventDefault();
      void input.run(() => updateStructuredCreatorRequest(input.conversationId, input.request.id, {
        action: "propose_terms",
        agreedAmountMinor: Number(amount),
        expectedDeliveryDays: Number(deliveryDays)
      }));
    }}>
      <label className="grid gap-1 text-xs text-(--muted)">Revised atomic amount
        <input className="w-44 rounded border border-(--line) bg-(--background) p-2 text-sm" min="1" required type="number" value={amount} onChange={(event) => setAmount(event.target.value)} />
      </label>
      <label className="grid gap-1 text-xs text-(--muted)">Delivery days
        <input className="w-28 rounded border border-(--line) bg-(--background) p-2 text-sm" max="90" min="1" required type="number" value={deliveryDays} onChange={(event) => setDeliveryDays(event.target.value)} />
      </label>
      <button className="ghost-button" type="submit">Propose revised terms</button>
    </form>
  );
}
