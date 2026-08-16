import { getLiveRoom } from "@/api-client";
import { requireAppAccess } from "@/supabase/route-guard";
import { AppShell } from "../../../app-shell";
import { ErrorState, PageHeader } from "../../../ui";
import { LiveHostWorkspace } from "./live-host-workspace";

export const dynamic = "force-dynamic";

export default async function LiveHostPage({ params }: { params: Promise<{ liveRoomId: string }> }) {
  await requireAppAccess("/app/live");
  const { liveRoomId } = await params;
  const result = await getLiveRoom(liveRoomId);

  return (
    <AppShell>
      <section className="mx-auto grid w-full max-w-4xl content-start gap-5">
        <PageHeader eyebrow="Live studio" title={result.ok ? result.data.title : "Live room"}>
          Connect OBS, check the room, and end the broadcast from one private screen.
        </PageHeader>
        {result.ok ? (
          <LiveHostWorkspace initialRoom={result.data} />
        ) : (
          <ErrorState context="Live room" result={result} title="Live room unavailable" />
        )}
      </section>
    </AppShell>
  );
}
