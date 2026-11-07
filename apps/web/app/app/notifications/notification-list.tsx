"use client";

import Link from "next/link";
import type { Route } from "next";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { NotificationPage } from "@/api-client";
import { getNotificationsForMutation, markNotificationRead } from "@/api-mutations";
import { safeMutationMessage } from "@/api-errors";
import { safeSameOriginPath } from "@/navigation/safe-same-origin-path";

export function NotificationList({ actorUserId, initialPage }: { actorUserId: string; initialPage: NotificationPage }) {
  const queryClient = useQueryClient();
  const queryKey = ["notifications", actorUserId] as const;
  const notifications = useQuery({
    initialData: initialPage,
    queryFn: getNotificationsForMutation,
    queryKey
  });
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function markRead(notificationId: string) {
    await queryClient.cancelQueries({ queryKey });
    const previous = queryClient.getQueryData<NotificationPage>(queryKey);
    setPendingId(notificationId);
    setError(null);
    queryClient.setQueryData<NotificationPage>(queryKey, (current) => ({
      ...current,
      items: (current?.items ?? []).map((item) => item.id === notificationId ? {
        ...item,
        state: "read",
        readAt: new Date().toISOString()
      } : item)
    }));
    try {
      const updated = await markNotificationRead(notificationId);
      queryClient.setQueryData<NotificationPage>(queryKey, (current) => ({
        ...current,
        items: (current?.items ?? []).map((item) => item.id === updated.id ? updated : item)
      }));
    } catch (reason) {
      if (previous) queryClient.setQueryData(queryKey, previous);
      setError(safeMutationMessage(reason, "Notification"));
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="divide-y divide-(--line)">
      {notifications.data.items.length === 0 ? (
        <div className="p-5 text-center">
          <h2 className="font-semibold">You’re all caught up</h2>
          <p className="mt-2 text-sm text-(--muted)">New account activity appears here.</p>
        </div>
      ) : null}
      {notifications.data.items.map((item) => {
        const actionUrl = safeInternalAction(item.actionUrl);
        return (
          <article className={item.state === "unread" ? "bg-(--accent-soft) p-4" : "p-4"} key={item.id}>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-wide text-(--muted)">{item.kind.replaceAll("_", " ")}</p>
                <h2 className="mt-1 font-semibold">{item.title}</h2>
                {item.body ? <p className="mt-1 text-sm leading-6 text-(--muted)">{item.body}</p> : null}
                <p className="mt-2 text-xs text-(--muted)">{new Date(item.createdAt).toLocaleString()}</p>
              </div>
              {item.state === "unread" ? (
                <button
                  className="ghost-button shrink-0"
                  disabled={pendingId === item.id}
                  onClick={() => void markRead(item.id)}
                  type="button"
                >
                  {pendingId === item.id ? "Saving" : "Mark read"}
                </button>
              ) : null}
            </div>
            {actionUrl ? <Link className="mt-3 inline-flex text-sm font-medium text-(--accent-text)" href={actionUrl as Route}>Open</Link> : null}
          </article>
        );
      })}
      {error ? <p aria-live="polite" className="p-4 text-sm text-(--danger)">{error}</p> : null}
    </div>
  );
}

function safeInternalAction(value: string | null | undefined) {
  return safeSameOriginPath(value, null);
}
