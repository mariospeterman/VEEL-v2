"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { LiveRoomPage } from "@/api-client";
import { getMyLiveRoomsForMutation } from "@/api-mutations";
import { appendUniquePageItems } from "@/pagination/merge-page-items";

const queryKey = ["live", "owned-rooms"] as const;

export function OwnedLiveRoomHistory() {
  const queryClient = useQueryClient();
  const rooms = useQuery({ queryKey, queryFn: () => getMyLiveRoomsForMutation() });
  const [paging, setPaging] = useState({ pending: false, error: false });

  const loadOlder = async () => {
    const cursor = rooms.data?.nextCursor;
    if (!cursor || paging.pending) return;
    setPaging({ pending: true, error: false });
    try {
      const page = await getMyLiveRoomsForMutation(cursor);
      queryClient.setQueryData<LiveRoomPage>(queryKey, (current) => ({
        items: appendUniquePageItems(current?.items ?? [], page.items),
        nextCursor: page.nextCursor
      }));
      setPaging({ pending: false, error: false });
    } catch {
      setPaging({ pending: false, error: true });
    }
  };

  return (
    <section aria-labelledby="owned-live-rooms-heading" className="mt-5 border-t border-(--line) pt-5">
      <h3 className="font-semibold" id="owned-live-rooms-heading">Your live rooms</h3>
      {rooms.isLoading ? <p className="mt-2 text-sm text-(--muted)">Loading live room history…</p> : null}
      {rooms.isError ? <p className="mt-2 text-sm text-(--danger)" role="alert">Live room history could not be loaded.</p> : null}
      {rooms.data?.items.length === 0 ? <p className="mt-2 text-sm text-(--muted)">Rooms you create will appear here.</p> : null}
      {rooms.data?.items.length ? (
        <div className="mt-3 grid gap-2">
          {rooms.data.items.map((room) => (
            <a className="flex min-h-11 items-center justify-between gap-3 rounded border border-(--line) bg-(--background) px-3 py-2 text-sm" href={`/app/live/${encodeURIComponent(room.id)}`} key={room.id}>
              <span className="min-w-0 truncate font-medium">{room.title}</span>
              <span className="shrink-0 text-xs text-(--muted)">{room.state.replace("_", " ")}</span>
            </a>
          ))}
        </div>
      ) : null}
      {rooms.data?.nextCursor ? (
        <button className="secondary-button mt-3" disabled={paging.pending} onClick={() => void loadOlder()} type="button">
          {paging.pending ? "Loading…" : "Load older live rooms"}
        </button>
      ) : null}
      {paging.error ? <p className="mt-2 text-sm text-(--danger)" role="alert">Older live rooms could not be loaded. Try again.</p> : null}
    </section>
  );
}
