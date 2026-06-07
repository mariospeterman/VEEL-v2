import { appShellNavItems } from "@veel/ui";
import {
  getConversationMessages,
  getConversations,
  type ApiResult,
  type Conversation,
  type ConversationList,
  type Message,
  type MessagePage
} from "@/api-client";
import { requireConfiguredSession } from "@/supabase/route-guard";

export const dynamic = "force-dynamic";

export default async function MessagesPage() {
  await requireConfiguredSession("/messages");

  const conversations = await getConversations();
  const selectedConversation = conversations.ok ? (conversations.data.items[0] ?? null) : null;
  const messages = selectedConversation
    ? await getConversationMessages(selectedConversation.id)
    : null;

  return (
    <main className="min-h-screen bg-(--background) text-(--foreground)">
      <nav className="mx-auto flex w-full max-w-6xl items-center justify-between border-b border-(--line) px-5 py-4">
        <a className="text-lg font-semibold tracking-normal" href="/">
          VEEL
        </a>
        <div className="flex gap-1">
          {appShellNavItems.map((item) => (
            <a
              className="rounded px-3 py-2 text-sm text-(--muted) transition hover:bg-(--panel) hover:text-(--foreground)"
              href={item.href}
              key={item.href}
            >
              {item.label}
            </a>
          ))}
        </div>
      </nav>

      <section className="mx-auto grid w-full max-w-6xl gap-5 px-5 py-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="rounded border border-(--line) bg-(--panel)">
          <div className="border-b border-(--line) p-4">
            <p className="text-sm font-medium text-(--accent)">Messages</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-normal">Inbox</h1>
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
              <EmptyState label="No conversations yet" />
            )
          ) : (
            <UnavailableState result={conversations} title="Messages unavailable" />
          )}
        </aside>

        <section className="rounded border border-(--line) bg-(--panel)">
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
                    <EmptyState label="No visible messages yet" />
                  )
                ) : messages ? (
                  <UnavailableState result={messages} title="Conversation unavailable" />
                ) : null}
              </div>
            </>
          ) : conversations.ok ? (
            <div className="p-4">
              <EmptyState label="Select a conversation after one is available" />
            </div>
          ) : (
            <div className="p-4">
              <UnavailableState result={conversations} title="Conversation unavailable" />
            </div>
          )}
        </section>
      </section>
    </main>
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
    <article
      className={`grid gap-1 border-b border-(--line) p-4 ${
        isSelected ? "bg-(--accent-soft)" : ""
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="font-medium">{conversation.title}</p>
        {conversation.unreadCount > 0 ? (
          <span className="rounded bg-(--background) px-2 py-1 text-xs font-semibold text-(--accent-strong)">
            {conversation.unreadCount}
          </span>
        ) : null}
      </div>
      {conversation.lastMessage ? (
        <p className="truncate text-sm text-(--muted)">{conversation.lastMessage.body}</p>
      ) : (
        <p className="text-sm text-(--muted)">No messages yet</p>
      )}
    </article>
  );
}

function MessageBubble({ message }: { message: Message }) {
  return (
    <article className="max-w-[640px] rounded border border-(--line) bg-(--background) p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium">{message.sender.displayName}</p>
        <span className="rounded bg-(--panel) px-2 py-1 text-xs text-(--muted)">
          {message.deliveryState}
        </span>
      </div>
      <p className="mt-2 text-sm leading-6">{message.body}</p>
    </article>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="rounded border border-(--line) bg-(--background) p-4 text-sm text-(--muted)">
      {label}
    </div>
  );
}

function UnavailableState({
  result,
  title
}: {
  result: ApiResult<ConversationList> | ApiResult<MessagePage>;
  title: string;
}) {
  if (result.ok) {
    return null;
  }

  return (
    <div className="rounded border border-(--line) bg-(--background) p-4">
      <p className="text-sm font-medium text-(--accent)">HTTP {result.status}</p>
      <h2 className="mt-2 text-base font-semibold tracking-normal">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-(--muted)">{result.message}</p>
    </div>
  );
}
