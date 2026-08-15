"use client";

import Link from "next/link";
import type { Route } from "next";
import { useState } from "react";
import type { Notification } from "@/api-client";
import { markNotificationRead } from "@/api-mutations";
import { safeMutationMessage } from "@/api-errors";

export function NotificationList({ initialItems }: { initialItems: Notification[] }) {
  const [items, setItems] = useState(initialItems);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function markRead(notificationId: string) {
    setPendingId(notificationId);
    setError(null);
    try {
      const updated = await markNotificationRead(notificationId);
      setItems((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (reason) {
      setError(safeMutationMessage(reason, "Notification"));
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="divide-y divide-(--line)">
      {items.map((item) => {
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
            {actionUrl ? <Link className="mt-3 inline-flex text-sm font-medium text-(--accent)" href={actionUrl as Route}>Open</Link> : null}
          </article>
        );
      })}
      {error ? <p aria-live="polite" className="p-4 text-sm text-(--danger)">{error}</p> : null}
    </div>
  );
}

function safeInternalAction(value: string | null | undefined) {
  return value?.startsWith("/") && !value.startsWith("//") ? value : null;
}
