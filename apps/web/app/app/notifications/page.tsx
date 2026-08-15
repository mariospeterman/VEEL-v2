import { getNotifications } from "@/api-client";
import { requireAppAccess } from "@/supabase/route-guard";
import { AppShell } from "../../app-shell";
import { Card, EmptyState, ErrorState, PageHeader } from "../../ui";
import { NotificationList } from "./notification-list";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  await requireAppAccess("/app/notifications");
  const notifications = await getNotifications();

  return (
    <AppShell>
      <section className="mx-auto grid w-full max-w-3xl content-start gap-5">
        <PageHeader eyebrow="Account" title="Notifications">
          Messages, access, payments, safety, and creator operations in one account-owned inbox.
        </PageHeader>
        <Card>
          {notifications.ok ? (
            notifications.data.items.length > 0 ? (
              <NotificationList initialItems={notifications.data.items} />
            ) : (
              <div className="p-5">
                <EmptyState title="You’re all caught up">New account activity appears here.</EmptyState>
              </div>
            )
          ) : (
            <div className="p-5">
              <ErrorState result={notifications} title="Notifications unavailable" context="Notifications" />
            </div>
          )}
        </Card>
      </section>
    </AppShell>
  );
}
