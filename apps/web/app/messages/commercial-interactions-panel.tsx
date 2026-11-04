"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Conversation } from "@/api-client";
import type {
  ConversationCommercialInteractions,
  StructuredCreatorRequest
} from "@/api-mutation-types";
import {
  createCreatorMediaOffer,
  createCreatorMediaOfferPaymentIntent,
  createStructuredCreatorRequest,
  createStructuredCreatorRequestPaymentIntent,
  getConversationCommercialInteractions,
  updateCreatorMediaOffer,
  updateStructuredCreatorRequest
} from "@/api-mutations";
import {
  formatCommercialSolAmountInput,
  parseOptionalCommercialSolAmount,
  parseRequiredCommercialSolAmount
} from "@/commercial-amount-input";
import {
  AssetAmountInputError,
  formatAtomicAssetAmount
} from "@/format-asset-amount";
import { safeMutationMessage } from "@/api-errors";
import { PaymentHandoffPanel } from "@/payment-handoff-panel";
import { appendUniquePageItems } from "@/pagination/merge-page-items";

export function CommercialInteractionsPanel({ conversation }: { conversation: Conversation }) {
  const queryClient = useQueryClient();
  const queryKey = ["messages", "conversation", conversation.id, "commercial"] as const;
  const interactions = useQuery({
    queryKey,
    queryFn: () => getConversationCommercialInteractions(conversation.id),
    enabled: conversation.requestState === "accepted"
  });
  const [status, setStatus] = useState<string | null>(null);
  const [paging, setPaging] = useState({ pending: false, error: false });
  const refresh = () => queryClient.invalidateQueries({ queryKey });

  if (conversation.requestState !== "accepted") return null;

  const run = async (action: () => Promise<unknown>) => {
    setStatus(null);
    try {
      await action();
      await refresh();
    } catch (error) {
      setStatus(commercialMutationMessage(error, "Commercial interaction"));
    }
  };

  const loadOlder = async () => {
    const cursor = interactions.data?.nextCursor;
    if (!cursor || paging.pending) return;
    setPaging({ pending: true, error: false });
    try {
      const page = await getConversationCommercialInteractions(conversation.id, cursor);
      queryClient.setQueryData<ConversationCommercialInteractions>(queryKey, (current) => ({
        mediaOffers: appendUniquePageItems(current?.mediaOffers ?? [], page.mediaOffers),
        creatorRequests: appendUniquePageItems(current?.creatorRequests ?? [], page.creatorRequests),
        nextCursor: page.nextCursor
      }));
      setPaging({ pending: false, error: false });
    } catch {
      setPaging({ pending: false, error: true });
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
                <div><p className="text-sm font-semibold">{offer.title}</p><p className="text-xs text-(--muted)">{formatAtomicAssetAmount(offer.amountMinor, offer.currency)} · revision {offer.contentRevision} · {offer.state}</p></div>
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
                    onConfirmed={refresh}
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
          const quotedAmount = request.agreedAmountMinor ?? request.proposedAmountMinor;
          return (
            <article className="rounded border border-(--line) bg-(--background) p-3" key={request.id}>
              <p className="text-sm font-semibold">Structured {request.permittedCategory} request</p>
              <p className="mt-1 text-sm text-(--muted)">{request.deliverable}</p>
              <p className="mt-2 text-xs text-(--muted)">{quotedAmount == null ? "No price proposed" : formatAtomicAssetAmount(quotedAmount, request.currency)} · terms v{request.termsRevision} · {request.state}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {currentUserIsCreator && request.state === "proposed" ? <button className="ghost-button" type="button" onClick={() => void run(() => updateStructuredCreatorRequest(conversation.id, request.id, { action: "accept", expectedTermsRevision: request.termsRevision }))}>Accept terms</button> : null}
                {currentUserIsCreator && ["proposed", "terms_proposed"].includes(request.state) ? <button className="ghost-button" type="button" onClick={() => void run(() => updateStructuredCreatorRequest(conversation.id, request.id, { action: "decline" }))}>Decline</button> : null}
                {!currentUserIsCreator && request.state === "terms_proposed" ? <button className="ghost-button" type="button" onClick={() => void run(() => updateStructuredCreatorRequest(conversation.id, request.id, { action: "accept_terms", expectedTermsRevision: request.termsRevision }))}>Accept revised terms</button> : null}
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
                    onConfirmed={refresh}
                    pendingLabel="Preparing creator request"
                    readyCopy="Verified settlement activates the delivery workspace; it does not guarantee personal attention or access."
                  />
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
      {interactions.data?.nextCursor ? (
        <button className="secondary-button mt-3" disabled={paging.pending} onClick={() => void loadOlder()} type="button">
          {paging.pending ? "Loading…" : "Load older offers and requests"}
        </button>
      ) : null}
      {paging.error ? <p className="mt-3 text-sm text-(--danger)" role="alert">Older commercial history could not be loaded. Try again.</p> : null}
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
      let amountAtomic;
      try {
        amountAtomic = parseRequiredCommercialSolAmount(amount);
      } catch (error) {
        input.onError(commercialMutationMessage(error, "Media offer"));
        return;
      }
      void createCreatorMediaOffer(input.conversationId, {
        contentItemId,
        title,
        amountMinor: amountAtomic,
        currency: "SOL",
        expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString()
      }).then(() => { setContentItemId(""); setTitle(""); setAmount(""); return input.onCreated(); }).catch((error) => input.onError(commercialMutationMessage(error, "Media offer")));
    }}>
      <p className="text-sm font-semibold">Offer approved media</p>
      <input className="rounded border border-(--line) bg-(--background) p-2 text-sm" placeholder="Approved content ID" required value={contentItemId} onChange={(event) => setContentItemId(event.target.value)} />
      <input className="rounded border border-(--line) bg-(--background) p-2 text-sm" maxLength={120} placeholder="Offer title" required value={title} onChange={(event) => setTitle(event.target.value)} />
      <label className="grid gap-1 text-xs text-(--muted)">Price (SOL)
        <input className="rounded border border-(--line) bg-(--background) p-2 text-sm" inputMode="decimal" maxLength={18} pattern="[0-9]+([.][0-9]{1,9})?" placeholder="1.00" required value={amount} onChange={(event) => setAmount(event.target.value)} />
      </label>
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
      let proposedAmountAtomic;
      try {
        proposedAmountAtomic = parseOptionalCommercialSolAmount(amount);
      } catch (error) {
        input.onError(commercialMutationMessage(error, "Creator request"));
        return;
      }
      void createStructuredCreatorRequest(input.conversation.id, {
        creatorUserId: input.conversation.counterpart.id,
        deliverable,
        permittedCategory: category,
        proposedAmountMinor: proposedAmountAtomic,
        currency: "SOL",
        expectedDeliveryDays: Number(deliveryDays),
        clarificationRule: "One written clarification before creator acceptance.",
        cancellationRule: "Cancellation before payment; remediation review after verified settlement.",
        expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString()
      }).then(() => { setDeliverable(""); setAmount(""); return input.onCreated(); }).catch((error) => input.onError(commercialMutationMessage(error, "Creator request")));
    }}>
      <p className="text-sm font-semibold">Propose creator request</p>
      <textarea className="min-h-20 rounded border border-(--line) bg-(--background) p-2 text-sm" maxLength={1000} placeholder="Define the deliverable only—no personal or offline access." required value={deliverable} onChange={(event) => setDeliverable(event.target.value)} />
      <label className="grid gap-1 text-xs text-(--muted)">Permitted format
        <select className="rounded border border-(--line) bg-(--background) p-2 text-sm text-(--foreground)" value={category} onChange={(event) => setCategory(event.target.value as typeof category)}>
          <option value="photo">Photo</option><option value="video">Video</option><option value="audio">Audio</option><option value="written">Written</option><option value="other_safe">Other safe deliverable</option>
        </select>
      </label>
      <label className="grid gap-1 text-xs text-(--muted)">Optional price (SOL)
        <input className="rounded border border-(--line) bg-(--background) p-2 text-sm" inputMode="decimal" maxLength={18} pattern="[0-9]+([.][0-9]{1,9})?" placeholder="1.00" value={amount} onChange={(event) => setAmount(event.target.value)} />
      </label>
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
  const initialAmountAtomic = input.request.agreedAmountMinor ?? input.request.proposedAmountMinor;
  const [amount, setAmount] = useState(
    initialAmountAtomic == null ? "" : formatCommercialSolAmountInput(initialAmountAtomic)
  );
  const [deliveryDays, setDeliveryDays] = useState(String(input.request.expectedDeliveryDays ?? 14));
  return (
    <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={(event) => {
      event.preventDefault();
      void input.run(() => updateStructuredCreatorRequest(input.conversationId, input.request.id, {
        action: "propose_terms",
        expectedTermsRevision: input.request.termsRevision,
        agreedAmountMinor: parseRequiredCommercialSolAmount(amount),
        expectedDeliveryDays: Number(deliveryDays)
      }));
    }}>
      <label className="grid gap-1 text-xs text-(--muted)">Revised price (SOL)
        <input className="w-44 rounded border border-(--line) bg-(--background) p-2 text-sm" inputMode="decimal" maxLength={18} pattern="[0-9]+([.][0-9]{1,9})?" required value={amount} onChange={(event) => setAmount(event.target.value)} />
      </label>
      <label className="grid gap-1 text-xs text-(--muted)">Delivery days
        <input className="w-28 rounded border border-(--line) bg-(--background) p-2 text-sm" max="90" min="1" required type="number" value={deliveryDays} onChange={(event) => setDeliveryDays(event.target.value)} />
      </label>
      <button className="ghost-button" type="submit">Propose revised terms</button>
    </form>
  );
}

function commercialMutationMessage(error: unknown, context: string): string {
  return error instanceof AssetAmountInputError
    ? error.message
    : safeMutationMessage(error, context);
}
