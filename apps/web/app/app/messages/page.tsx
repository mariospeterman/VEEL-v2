import {
  getConversationMessages,
  getConversations,
  type Conversation,
  type Message,
} from "@/api-client";
import { MessageComposer } from "../../messages/message-composer";
import { requireAppAccess } from "@/supabase/route-guard";
import { AppShell } from "../../app-shell";
import { Card, EmptyState, ErrorState, PageHeader, StatusPill } from "../../ui";

export const dynamic = "force-dynamic";

export default async function MessagesPage({
  searchParams
}: {
  searchParams?: Promise<{ conversation?: string }>;
}) {
  await requireAppAccess("/app/messages");

  const params = await searchParams;
  const conversations = await getConversations();
  const requestedConversationId = params?.conversation;
  const selectedConversation = conversations.ok
    ? (conversations.data.items.find((item) => item.id === requestedConversationId) ??
      conversations.data.items[0] ??
      null)
    : null;
  const messages = selectedConversation
    ? await getConversationMessages(selectedConversation.id)
    : null;

  return (
    <AppShell>
      <PageHeader eyebrow="Messages" title="Inbox">
        Conversations, requests, Mutual tags, paid messages, and safety controls stay backend-gated.
      </PageHeader>

      <section className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
        <Card>
          <div className="border-b border-(--line) p-4">
            <p className="eyebrow">Threads</p>
          </div>
          {conversations.ok ? (
            conversations.data.items.length > 0 ? (
              conversations.data.items.map((conversation) => (
                <ConversationRow
                  conversation={conversation}
                  isSelected={conversation.id === selectedConversation?.id}
                  key={conversation.id}
                />
              ))
            ) : (
              <div className="p-4">
                <EmptyState title="No conversations yet">
                  Accepted messages and Mutual conversations appear here.
                </EmptyState>
              </div>
            )
          ) : (
            <div className="p-4">
              <ErrorState result={conversations} title="Messages unavailable" context="Messages" />
            </div>
          )}
        </Card>

        <Card>
          {selectedConversation ? (
            <>
              <div className="border-b border-(--line) p-4">
                <h2 className="text-lg font-semibold tracking-normal">{selectedConversation.title}</h2>
                <p className="mt-1 text-sm capitalize text-(--muted)">
                  {selectedConversation.type} conversation
                </p>
              </div>

              <div className="grid gap-3 p-4">
                {messages?.ok ? (
                  messages.data.items.length > 0 ? (
                    messages.data.items.map((message) => <MessageBubble message={message} key={message.id} />)
                  ) : (
                    <EmptyState title="No visible messages yet">
                      Messages appear after backend delivery and safety checks.
                    </EmptyState>
                  )
                ) : messages ? (
                  <ErrorState result={messages} title="Conversation unavailable" context="Conversation" />
                ) : null}
              </div>
              <MessageComposer conversation={selectedConversation} />
            </>
          ) : conversations.ok ? (
            <div className="p-4">
              <EmptyState title="Select a conversation">
                Choose a thread after one is available.
              </EmptyState>
            </div>
          ) : (
            <div className="p-4">
              <ErrorState result={conversations} title="Conversation unavailable" context="Conversation" />
            </div>
          )}
        </Card>
      </section>
    </AppShell>
  );
}

function ConversationRow({
  conversation,
  isSelected
}: {
  conversation: Conversation;
  isSelected: boolean;
}) {
  return (
    <a
      aria-current={isSelected ? "page" : undefined}
      className={`grid gap-1 border-b border-(--line) p-4 ${
        isSelected ? "bg-(--accent-soft)" : ""
      }`}
      href={`/app/messages?conversation=${encodeURIComponent(conversation.id)}`}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="font-medium">{conversation.title}</p>
        {conversation.unreadCount > 0 ? <StatusPill tone="good">{conversation.unreadCount}</StatusPill> : null}
      </div>
      {conversation.lastMessage ? (
        <p className="truncate text-sm text-(--muted)">{conversation.lastMessage.body}</p>
      ) : (
        <p className="text-sm text-(--muted)">No messages yet</p>
      )}
    </a>
  );
}

function MessageBubble({ message }: { message: Message }) {
  return (
    <article className="max-w-[640px] rounded border border-(--line) bg-(--background) p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium">{message.sender.displayName}</p>
        <StatusPill>{message.deliveryState}</StatusPill>
      </div>
      <p className="mt-2 text-sm leading-6">{message.body}</p>
    </article>
  );
}
