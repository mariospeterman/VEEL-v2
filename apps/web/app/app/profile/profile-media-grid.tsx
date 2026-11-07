"use client";

import { useState } from "react";
import type { CreatorMediaItem, CreatorMediaPage } from "@/api-client";
import { ApiMutationError, getMyContentPage } from "@/api-mutations";

export type ProfileMediaFilter = "posts" | "bits" | "moments";

export function ProfileMediaGrid({ filter, page }: { filter: ProfileMediaFilter; page: CreatorMediaPage }) {
  const [allItems, setAllItems] = useState(page.items);
  const [nextCursor, setNextCursor] = useState(page.nextCursor);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const items = allItems.filter((item) => isVisibleInFilter(item, filter));

  async function loadMore() {
    if (!nextCursor || pending) return;
    setPending(true);
    setError(null);
    try {
      const next = await getMyContentPage(nextCursor);
      setAllItems((current) => {
        const known = new Set(current.map((item) => item.id));
        return [...current, ...next.items.filter((item) => !known.has(item.id))];
      });
      setNextCursor(next.nextCursor);
    } catch (reason) {
      setError(reason instanceof ApiMutationError ? reason.message : "More profile media could not be loaded.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid gap-4">
      {items.length > 0 ? (
        <div aria-label={`Published ${filter}`} className="grid grid-cols-3 gap-0.5 sm:gap-1">
          {items.map((item) => (
            <a aria-label={item.caption || "Open post"} className="group relative aspect-square overflow-hidden bg-[#080b11]" href={`/content/${item.id}`} key={item.id}>
              {item.posterUrl ? <img alt="" className="size-full object-cover transition group-hover:scale-[1.02]" src={item.posterUrl} /> : <span className="grid size-full place-items-center px-2 text-center text-xs text-white/60">{item.mediaType}</span>}
              {item.mediaType !== "image" ? <span className="absolute right-2 top-2 rounded-full bg-black/60 px-2 py-1 text-[10px] font-semibold uppercase text-white">{item.mediaType}</span> : null}
            </a>
          ))}
        </div>
      ) : (
        <div className="grid min-h-52 place-items-center border-y border-(--line) text-center">
          <div><p className="font-semibold">No published {filter} found</p>{!nextCursor ? <a className="mt-3 inline-flex text-sm font-semibold text-(--accent-text)" href="/app/create">Create media</a> : null}</div>
        </div>
      )}
      {nextCursor ? <button className="secondary-button justify-self-center" disabled={pending} onClick={() => void loadMore()} type="button">{pending ? "Loading" : "Load more"}</button> : null}
      {error ? <p className="text-sm text-(--danger)" role="alert">{error}</p> : null}
    </div>
  );
}

function isVisibleInFilter(item: CreatorMediaItem, filter: ProfileMediaFilter) {
  if (item.publicationState !== "published") return false;
  if (item.mediaType === "text" || item.mediaType === "poll") return false;
  if (filter === "moments") return item.distributionMode === "moment";
  if (filter === "bits") return item.mediaType === "bit" && item.distributionMode === "post";
  return item.distributionMode === "post" && item.mediaType !== "bit";
}
