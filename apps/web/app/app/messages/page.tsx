import { getConversationMessages, getConversations } from "@/api-client";
import { requireAppAccess } from "@/supabase/route-guard";
import { MessagesWorkspace } from "../../messages/messages-workspace";
import { AppShell } from "../../app-shell";
import { PageHeader } from "../../ui";

export const dynamic = "force-dynamic";

export default async function MessagesPage({
  searchParams
}: {
  searchParams?: Promise<{ conversation?: string }>;
}) {
  await requireAppAccess("/app/messages");
  const params = await searchParams;
  const conversationsResult = await getConversations();
  const conversations = conversationsResult.ok ? conversationsResult.data.items : [];
  const selected = conversations.find((item) => item.id === params?.conversation) ?? conversations[0] ?? null;
  const messagesResult = selected ? await getConversationMessages(selected.id) : null;
  const messages = messagesResult?.ok ? messagesResult.data.items : [];

  return (
    <AppShell>
      <PageHeader eyebrow="Messages" title="Inbox">
        One respectful introduction, explicit consent, and natural realtime updates—without paid inbox access.
      </PageHeader>
      <MessagesWorkspace
        initialConversationId={selected?.id ?? null}
        initialConversations={conversations}
        initialMessages={messages}
      />
    </AppShell>
  );
}
