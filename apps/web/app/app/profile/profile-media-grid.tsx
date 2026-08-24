import type { CreatorMediaPage } from "@/api-client";

export function ProfileMediaGrid({ page }: { page: CreatorMediaPage }) {
  const items = page.items.filter((item) => item.publicationState === "published" && item.distributionMode === "post");
  if (items.length === 0) {
    return (
      <div className="grid min-h-52 place-items-center border-y border-(--line) text-center">
        <div><p className="font-semibold">No published posts yet</p><a className="mt-3 inline-flex text-sm font-semibold text-(--accent-text)" href="/app/create">Create your first post</a></div>
      </div>
    );
  }
  return (
    <div aria-label="Published posts" className="grid grid-cols-3 gap-0.5 sm:gap-1">
      {items.map((item) => (
        <a aria-label={item.caption || "Open post"} className="group relative aspect-square overflow-hidden bg-[#080b11]" href={`/content/${item.id}`} key={item.id}>
          {item.posterUrl ? <img alt="" className="size-full object-cover transition group-hover:scale-[1.02]" src={item.posterUrl} /> : <span className="grid size-full place-items-center px-2 text-center text-xs text-white/60">{item.mediaType}</span>}
          {item.mediaType !== "image" ? <span className="absolute right-2 top-2 rounded-full bg-black/60 px-2 py-1 text-[10px] font-semibold uppercase text-white">{item.mediaType}</span> : null}
        </a>
      ))}
    </div>
  );
}
