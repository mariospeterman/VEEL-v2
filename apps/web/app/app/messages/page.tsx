import {
  getConversationMessages,
  getConversations,
  type ConversationList,
  type MessagePage
} from "@/api-client";
import { requireAppAccess } from "@/supabase/route-guard";
import { MessagesWorkspace } from "../../messages/messages-workspace";
import { AppShell } from "../../app-shell";
import { findSelectedConversation } from "@/messages/conversation-selection";

export const dynamic = "force-dynamic";

export default async function MessagesPage({
  searchParams
}: {
  searchParams?: Promise<{ conversation?: string; share?: string }>;
}) {
  const session = await requireAppAccess("/app/messages");
  const params = await searchParams;
  const conversationsResult = await getConversations();
  const conversations: ConversationList = conversationsResult.ok
    ? conversationsResult.data
    : { items: [], nextCursor: null };
  const selected = findSelectedConversation(conversations.items, params?.conversation);
  const messagesResult = selected ? await getConversationMessages(selected.id) : null;
  const messages: MessagePage = messagesResult?.ok
    ? messagesResult.data
    : { items: [], nextCursor: null };

  return (
    <AppShell>
      <h1 className="mb-4 text-2xl font-semibold tracking-tight">Messages</h1>
      <MessagesWorkspace
        actorUserId={session?.user?.id ?? null}
        initialConversationId={selected?.id ?? null}
        initialConversations={conversations}
        initialMessages={messages}
        initialMessagesAvailable={messagesResult?.ok ?? true}
        initialSharedContentItemId={params?.share ?? null}
      />
    </AppShell>
  );
}
