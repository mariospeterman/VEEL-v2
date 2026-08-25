import { getConversationMessages, getConversations } from "@/api-client";
import { requireAppAccess } from "@/supabase/route-guard";
import { MessagesWorkspace } from "../../messages/messages-workspace";
import { AppShell } from "../../app-shell";

export const dynamic = "force-dynamic";

export default async function MessagesPage({
  searchParams
}: {
  searchParams?: Promise<{ conversation?: string; share?: string }>;
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
      <h1 className="mb-4 text-2xl font-semibold tracking-tight">Messages</h1>
      <MessagesWorkspace
        initialConversationId={selected?.id ?? null}
        initialConversations={conversations}
      initialMessages={messages}
      initialMessagesAvailable={messagesResult?.ok ?? true}
      initialSharedContentItemId={params?.share ?? null}
    />
    </AppShell>
  );
}
