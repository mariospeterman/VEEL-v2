import { getNotifications } from "@/api-client";
import { requireAppAccess } from "@/supabase/route-guard";
import { AppShell } from "../../app-shell";
import { Card, ErrorState, PageHeader } from "../../ui";
import { NotificationList } from "./notification-list";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const session = await requireAppAccess("/app/notifications");
  const notifications = await getNotifications();

  return (
    <AppShell>
      <section className="mx-auto grid w-full max-w-3xl content-start gap-5">
        <PageHeader eyebrow="Account" title="Notifications">
          Messages, access, payments, safety, and creator operations in one account-owned inbox.
        </PageHeader>
        <Card>
          {notifications.ok ? (
            <NotificationList actorUserId={session?.user?.id ?? "unknown"} initialPage={notifications.data} />
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
