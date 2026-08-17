"use client";

import { useRef, useState } from "react";
import type { MutualsFeedItem, MutualsFeedPage, MutualsInterestResult } from "@/api-client";
import { createMutualsInterest } from "@/api-mutations";
import { safeMutationMessage } from "@/api-errors";
import { createMutationIdempotencyKey } from "@/api-mutation-transport";

type InterestAction = "yes" | "not_interested";
type ItemState = {
  action: InterestAction | null;
  error: string | null;
  pending: InterestAction | null;
  result: MutualsInterestResult | null;
};

const idleState: ItemState = { action: null, error: null, pending: null, result: null };

export function MutualsFeed({ feed }: { feed: MutualsFeedPage }) {
  const pendingItems = useRef(new Set<string>());
  const retryKeys = useRef(new Map<string, string>());
  const [itemStates, setItemStates] = useState<Record<string, ItemState>>({});

  if (feed.items.length === 0) {
    return (
      <section className="rounded border border-(--line) bg-(--panel) p-5">
        <h2 className="text-base font-semibold tracking-normal">No Mutuals media yet</h2>
        <p className="mt-2 text-sm leading-6 text-(--muted)">
          Eligible media appears here only when both safety and Mutuals visibility rules pass.
        </p>
      </section>
    );
  }

  async function choose(item: MutualsFeedItem, action: InterestAction) {
    const current = itemStates[item.contentId] ?? idleState;
    if (
      pendingItems.current.has(item.contentId) ||
      current.result ||
      (current.error && current.action && current.action !== action)
    ) return;
    pendingItems.current.add(item.contentId);

    const retryKey = `${item.contentId}:${action}`;
    let idempotencyKey = retryKeys.current.get(retryKey);
    if (!idempotencyKey) {
      idempotencyKey = createMutationIdempotencyKey();
      retryKeys.current.set(retryKey, idempotencyKey);
    }

    setItemStates((states) => ({
      ...states,
      [item.contentId]: { ...current, action, error: null, pending: action }
    }));

    try {
      const result = await createMutualsInterest({
        action,
        contentId: item.contentId,
        targetUserId: item.creatorUserId
      }, idempotencyKey);
      retryKeys.current.delete(retryKey);
      pendingItems.current.delete(item.contentId);
      setItemStates((states) => ({
        ...states,
        [item.contentId]: { action: result.action, error: null, pending: null, result }
      }));
    } catch (error) {
      pendingItems.current.delete(item.contentId);
      setItemStates((states) => ({
        ...states,
        [item.contentId]: {
          action,
          error: safeMutationMessage(error, "Mutuals choice"),
          pending: null,
          result: null
        }
      }));
    }
  }

  return (
    <>
      {feed.items.map((item) => {
        const state = itemStates[item.contentId] ?? idleState;
        const completed = state.result !== null;

        return (
          <article className="overflow-hidden rounded border border-(--line) bg-(--panel)" key={item.contentId}>
            {item.posterUrl ? (
              <img alt="" className="aspect-[16/10] w-full object-cover" src={item.posterUrl} />
            ) : null}
            <div className="grid gap-4 p-4">
              <div>
                <p className="text-sm text-(--muted)">@{item.handle}</p>
                <h2 className="mt-1 text-lg font-semibold tracking-normal">{item.title}</h2>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  aria-pressed={completed && state.action === "not_interested"}
                  className="rounded border border-(--line) px-3 py-2 text-sm font-medium disabled:opacity-60"
                  disabled={state.pending !== null || completed || Boolean(state.error && state.action !== "not_interested")}
                  onClick={() => void choose(item, "not_interested")}
                  type="button"
                >
                  {state.pending === "not_interested" ? "Saving…" : "Not interested"}
                </button>
                <button
                  aria-pressed={completed && state.action === "yes"}
                  className="rounded bg-(--accent) px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
                  disabled={state.pending !== null || completed || Boolean(state.error && state.action !== "yes")}
                  onClick={() => void choose(item, "yes")}
                  type="button"
                >
                  {state.pending === "yes" ? "Saving…" : "Interested"}
                </button>
              </div>
              <InterestStatus state={state} />
            </div>
          </article>
        );
      })}
    </>
  );
}

function InterestStatus({ state }: { state: ItemState }) {
  if (state.error) {
    return <p className="text-sm text-red-300" role="alert">{state.error} Select the choice again to retry.</p>;
  }

  if (!state.result) return null;

  if (state.action === "not_interested") {
    return <p aria-live="polite" className="text-sm text-(--muted)">Hidden from your Mutuals choices.</p>;
  }

  return (
    <p aria-live="polite" className="text-sm text-(--muted)">
      {state.result.mutualCreated ? (
        <>It&apos;s mutual. <a className="font-semibold underline" href="/mutuals">Open Mutuals</a>.</>
      ) : "Interest saved. Nothing is shared unless it becomes mutual."}
    </p>
  );
}
