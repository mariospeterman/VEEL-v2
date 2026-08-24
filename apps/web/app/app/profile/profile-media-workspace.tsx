"use client";

import { useState, type FormEvent } from "react";
import type { CreatorMediaItem, CreatorMediaPage } from "@/api-client";
import {
  ApiMutationError,
  createContentModerationAppeal,
  getMyContentPage,
  reviewMediaAssetProvenance,
  type ContentMediaAssetMutationResult
} from "@/api-mutations";

export function ProfileMediaWorkspace({ initialPage }: { initialPage: CreatorMediaPage }) {
  const [items, setItems] = useState(initialPage.items);
  const [nextCursor, setNextCursor] = useState(initialPage.nextCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setPageError(null);
    try {
      const page = await getMyContentPage(nextCursor);
      setItems((current) => {
        const knownIds = new Set(current.map((item) => item.id));
        return [...current, ...page.items.filter((item) => !knownIds.has(item.id))];
      });
      setNextCursor(page.nextCursor);
    } catch (caught) {
      setPageError(caught instanceof ApiMutationError ? caught.message : "More media could not be loaded.");
    } finally {
      setLoadingMore(false);
    }
  }

  if (items.length === 0) {
    return (
      <section className="rounded border border-dashed border-(--line) bg-(--panel) p-6 text-center">
        <h2 className="text-base font-semibold">Your media will appear here</h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-(--muted)">
          Drafts stay private. Only media that completes review is visible on your public profile.
        </p>
        <a className="mt-4 inline-flex min-h-11 items-center rounded bg-(--foreground) px-4 py-2 text-sm font-semibold text-(--background)" href="/app/create">
          Create a post
        </a>
      </section>
    );
  }

  return (
    <section aria-labelledby="your-media-heading" className="grid gap-3">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold" id="your-media-heading">Your media</h2>
          <p className="mt-1 text-sm text-(--muted)">Drafts, review updates, and published posts in one place.</p>
        </div>
        <a className="rounded bg-(--foreground) px-3 py-2 text-sm font-semibold text-(--background)" href="/app/create">New post</a>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => (
          <MediaCard
            item={item}
            key={item.id}
            onAppealed={(contentId) => setItems((current) => current.map((entry) =>
              entry.id === contentId
                ? { ...entry, publicationState: "appeal_pending", reviewState: "appealed" }
                : entry
            ))}
            onProvenanceReviewed={(contentId, result) => setItems((current) => current.map((entry) =>
              entry.id === contentId
                ? {
                    ...entry,
                    compositionRevision: result.compositionRevision,
                    provenanceAssets: (entry.provenanceAssets ?? []).map((asset) =>
                      asset.mediaAssetId === result.asset.id
                        ? {
                            ...asset,
                            reviewState:
                              result.asset.provenanceReviewState &&
                              result.asset.provenanceReviewState !== "not_required"
                                ? result.asset.provenanceReviewState
                                : asset.reviewState
                          }
                        : asset
                    )
                  }
                : entry
            ))}
          />
        ))}
      </div>
      {pageError ? <p className="text-sm text-red-400" role="alert">{pageError}</p> : null}
      {nextCursor ? (
        <button
          className="min-h-11 justify-self-center rounded border border-(--line) px-4 py-2 text-sm font-semibold disabled:opacity-50"
          disabled={loadingMore}
          onClick={loadMore}
          type="button"
        >
          {loadingMore ? "Loading…" : "Load more media"}
        </button>
      ) : null}
    </section>
  );
}

function MediaCard({
  item,
  onAppealed,
  onProvenanceReviewed
}: {
  item: CreatorMediaItem;
  onAppealed: (contentId: string) => void;
  onProvenanceReviewed: (contentId: string, result: ContentMediaAssetMutationResult) => void;
}) {
  return (
    <article className="overflow-hidden rounded border border-(--line) bg-(--panel)">
      <div className="aspect-video bg-[#111827]">
        {item.posterUrl ? <img alt="" className="h-full w-full object-cover" src={item.posterUrl} /> : (
          <div className="grid h-full place-items-center px-4 text-center text-sm text-white/70">Preview appears after processing</div>
        )}
      </div>
      <div className="grid gap-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <p className="line-clamp-2 font-medium">{item.caption || "Untitled post"}</p>
          <PublicationPill state={item.publicationState} />
        </div>
        <p className="text-xs text-(--muted)">{publicationCopy(item.publicationState)}</p>
        {(item.provenanceAssets?.length ?? 0) > 0 ? (
          <section aria-label="Media provenance review" className="grid gap-2 rounded border border-(--line) p-3">
            <p className="text-sm font-semibold">AI media provenance</p>
            <p className="text-xs leading-5 text-(--muted)">
              Confirm that each label matches how this media was made. This review does not publish the draft.
            </p>
            {item.provenanceAssets?.map((asset) => (
              <ProvenanceReview
                asset={asset}
                compositionRevision={item.compositionRevision ?? 1}
                contentId={item.id}
                key={asset.mediaAssetId}
                onReviewed={onProvenanceReviewed}
              />
            ))}
          </section>
        ) : null}
        {item.reviewMessage ? (
          <div className="rounded bg-(--accent-soft) p-3 text-sm leading-5 text-(--accent-strong)">
            {item.reviewMessage}
          </div>
        ) : null}
        {item.publicationState === "rejected" || item.publicationState === "changes_requested" ? (
          <AppealForm contentId={item.id} onAppealed={onAppealed} />
        ) : null}
      </div>
    </article>
  );
}

function ProvenanceReview({
  asset,
  compositionRevision,
  contentId,
  onReviewed
}: {
  asset: NonNullable<CreatorMediaItem["provenanceAssets"]>[number];
  compositionRevision: number;
  contentId: string;
  onReviewed: (contentId: string, result: ContentMediaAssetMutationResult) => void;
}) {
  const [pending, setPending] = useState<"confirmed" | "rejected" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: "confirmed" | "rejected") {
    setPending(decision);
    setError(null);
    try {
      const result = await reviewMediaAssetProvenance(
        asset.mediaAssetId,
        { expectedCompositionRevision: compositionRevision, decision },
        crypto.randomUUID()
      );
      onReviewed(contentId, result);
    } catch (caught) {
      setError(caught instanceof ApiMutationError ? caught.message : "Provenance review could not be saved.");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="grid gap-2 rounded bg-(--background) p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span>{asset.kind} · {originCopy(asset.originClassification)}</span>
        <span className="rounded bg-(--accent-soft) px-2 py-1 text-(--accent-strong)">
          {asset.reviewState.replaceAll("_", " ")}
        </span>
      </div>
      {asset.reviewState === "pending" ? (
        <div className="flex flex-wrap gap-2">
          <button
            className="min-h-11 rounded bg-(--foreground) px-3 py-2 text-sm font-semibold text-(--background) disabled:opacity-50"
            disabled={pending !== null}
            onClick={() => void decide("confirmed")}
            type="button"
          >
            {pending === "confirmed" ? "Confirming…" : "Confirm label"}
          </button>
          <button
            className="min-h-11 rounded border border-(--line) px-3 py-2 text-sm font-semibold disabled:opacity-50"
            disabled={pending !== null}
            onClick={() => void decide("rejected")}
            type="button"
          >
            {pending === "rejected" ? "Rejecting…" : "Reject claim"}
          </button>
        </div>
      ) : asset.reviewState === "rejected" ? (
        <p className="text-xs leading-5 text-red-400">This asset remains private and cannot be released.</p>
      ) : (
        <p className="text-xs leading-5 text-emerald-500">Provenance label confirmed.</p>
      )}
      {error ? <p className="text-xs text-red-400" role="alert">{error}</p> : null}
    </div>
  );
}

function originCopy(origin: NonNullable<CreatorMediaItem["provenanceAssets"]>[number]["originClassification"]): string {
  if (origin === "ai_assisted") return "AI-assisted";
  if (origin === "ai_generated") return "AI-generated";
  return "Materially AI-manipulated";
}

function AppealForm({ contentId, onAppealed }: { contentId: string; onAppealed: (contentId: string) => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await createContentModerationAppeal(contentId, reason);
      onAppealed(contentId);
      setOpen(false);
    } catch (caught) {
      setError(caught instanceof ApiMutationError ? caught.message : "Appeal could not be submitted.");
    } finally {
      setPending(false);
    }
  }

  if (!open) {
    return <button className="justify-self-start text-sm font-semibold underline underline-offset-4" onClick={() => setOpen(true)} type="button">Appeal decision</button>;
  }

  return (
    <form className="grid gap-2" onSubmit={submit}>
      <label className="grid gap-1 text-sm">
        <span className="font-medium">Why should this be reviewed again?</span>
        <textarea className="min-h-24 rounded border border-(--line) bg-(--background) p-2" maxLength={2000} minLength={3} onChange={(event) => setReason(event.currentTarget.value)} required value={reason} />
      </label>
      {error ? <p className="text-sm text-red-400" role="alert">{error}</p> : null}
      <div className="flex gap-2">
        <button className="rounded bg-(--foreground) px-3 py-2 text-sm font-semibold text-(--background) disabled:opacity-50" disabled={pending || reason.trim().length < 3} type="submit">{pending ? "Sending…" : "Send appeal"}</button>
        <button className="rounded border border-(--line) px-3 py-2 text-sm" onClick={() => setOpen(false)} type="button">Cancel</button>
      </div>
    </form>
  );
}

function PublicationPill({ state }: { state: CreatorMediaItem["publicationState"] }) {
  const good = state === "published";
  return <span className={`shrink-0 rounded px-2 py-1 text-xs ${good ? "bg-emerald-500/15 text-emerald-500" : "bg-(--accent-soft) text-(--accent-strong)"}`}>{state.replaceAll("_", " ")}</span>;
}

function publicationCopy(state: CreatorMediaItem["publicationState"]): string {
  const copy: Record<CreatorMediaItem["publicationState"], string> = {
    draft: "Private draft",
    upload_pending: "Choose media to continue",
    processing: "Preparing your preview",
    in_review: "Private while the safety review completes",
    changes_requested: "Update requested before publication",
    rejected: "Not published",
    appeal_pending: "Appeal under review",
    published: "Visible on your public profile",
    blocked: "Unavailable pending support review"
  };
  return copy[state];
}
