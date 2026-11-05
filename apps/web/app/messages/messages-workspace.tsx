"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import type { ConversationList, Message, MessagePage } from "@/api-client";
import {
  getConversationMessagesForMutation,
  getConversationsForMutation,
  updateMessageReaction
} from "@/api-mutations";
import { useConversationEphemeral, useScopedRealtimeInvalidation } from "@/realtime-provider";
import { Card, EmptyState, StatusPill } from "../ui";
import { ConversationStateActions } from "./conversation-state-actions";
import { MessageComposer } from "./message-composer";
import { CommercialInteractionsPanel } from "./commercial-interactions-panel";
import {
  findSelectedConversation,
  replyForConversation
} from "@/messages/conversation-selection";
import {
  appendUniquePageItems,
  prependUniquePageItems
} from "@/pagination/merge-page-items";

export function MessagesWorkspace(input: {
  actorUserId: string | null;
  clientSessionScope: string | null;
  initialConversations: ConversationList;
  initialConversationId: string | null;
  initialMessages: MessagePage;
  initialMessagesAvailable: boolean;
  initialSharedContentItemId: string | null;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [reply, setReply] = useState<{ conversationId: string; message: Message } | null>(null);
  const [conversationPaging, setConversationPaging] = useState({ pending: false, error: false });
  const [messagePaging, setMessagePaging] = useState<{
    conversationId: string | null;
    pending: boolean;
    error: boolean;
  }>({ conversationId: null, pending: false, error: false });
  const conversations = useQuery({
    queryKey: ["messages", "conversations"],
    queryFn: () => getConversationsForMutation(),
    initialData: input.initialConversations
  });
  const selected = findSelectedConversation(conversations.data.items, input.initialConversationId);
  const replyTo = replyForConversation(reply, selected?.id);
  const messages = useQuery({
    queryKey: ["messages", "conversation", selected?.id],
    queryFn: () => getConversationMessagesForMutation(selected?.id ?? ""),
    enabled: Boolean(selected),
    retry: 1,
    initialData: selected?.id === input.initialConversationId && input.initialMessagesAvailable
      ? input.initialMessages
      : undefined
  });
  const scopedKeys = useMemo(
    () => selected ? [
      ["messages", "conversations"],
      ["messages", "conversation", selected.id],
      ["messages", "conversation", selected.id, "commercial"]
    ] : [],
    [selected?.id]
  );
  useScopedRealtimeInvalidation({
    topic: selected ? `conversation:${selected.id}` : null,
    topicKind: "conversation",
    queryKeys: scopedKeys
  });
  const ephemeral = useConversationEphemeral(
    selected?.requestState === "accepted" ? `conversation:${selected.id}` : null
  );

  const selectConversation = (conversationId: string | null) => {
    router.replace(conversationId
      ? `/app/messages?conversation=${encodeURIComponent(conversationId)}`
      : "/app/messages", { scroll: false });
  };

  const loadMoreConversations = async () => {
    const cursor = conversations.data.nextCursor;
    if (!cursor || conversationPaging.pending) return;
    setConversationPaging({ pending: true, error: false });
    try {
      const page = await getConversationsForMutation(cursor);
      queryClient.setQueryData<ConversationList>(["messages", "conversations"], (current) => ({
        items: appendUniquePageItems(current?.items ?? [], page.items),
        nextCursor: page.nextCursor
      }));
      setConversationPaging({ pending: false, error: false });
    } catch {
      setConversationPaging({ pending: false, error: true });
    }
  };

  const loadEarlierMessages = async () => {
    const conversationId = selected?.id;
    const cursor = messages.data?.nextCursor;
    if (!conversationId || !cursor || (messagePaging.conversationId === conversationId && messagePaging.pending)) {
      return;
    }
    setMessagePaging({ conversationId, pending: true, error: false });
    try {
      const page = await getConversationMessagesForMutation(conversationId, cursor);
      queryClient.setQueryData<MessagePage>(
        ["messages", "conversation", conversationId],
        (current) => ({
          items: prependUniquePageItems(current?.items ?? [], page.items),
          nextCursor: page.nextCursor
        })
      );
      setMessagePaging({ conversationId, pending: false, error: false });
    } catch {
      setMessagePaging({ conversationId, pending: false, error: true });
    }
  };

  const selectedMessagePaging = messagePaging.conversationId === selected?.id
    ? messagePaging
    : { conversationId: selected?.id ?? null, pending: false, error: false };

  return (
    <section className="grid min-h-[68vh] gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
      <Card className={selected ? "hidden lg:block" : "block"}>
        <div className="border-b border-(--line) p-4">
          <p className="eyebrow">Conversations</p>
          <p className="mt-1 text-sm text-(--muted)">Requests stay separate until you accept.</p>
        </div>
        {conversations.data.items.length > 0 ? conversations.data.items.map((conversation) => (
          <button
            aria-current={conversation.id === selected?.id ? "page" : undefined}
            className={`grid w-full gap-1 border-b border-(--line) p-4 text-left ${conversation.id === selected?.id ? "bg-(--accent-soft)" : "hover:bg-(--surface)"}`}
            key={conversation.id}
            onClick={() => selectConversation(conversation.id)}
            type="button"
          >
            <span className="flex items-center justify-between gap-3">
              <span className="font-medium">{conversation.title}</span>
              {conversation.unreadCount > 0 ? <StatusPill tone="good">{conversation.unreadCount}</StatusPill> : null}
            </span>
            <span className="truncate text-sm text-(--muted)">
              {conversation.lastMessage?.body ?? (conversation.requestState === "pending" ? "Message request" : "No messages yet")}
            </span>
          </button>
        )) : (
          <div className="p-4"><EmptyState title="No conversations yet">New conversations and requests appear here.</EmptyState></div>
        )}
        {conversations.data.nextCursor ? (
          <div className="grid gap-2 p-4">
            <button className="secondary-button justify-self-center" disabled={conversationPaging.pending} onClick={() => void loadMoreConversations()} type="button">
              {conversationPaging.pending ? "Loading…" : "Load more conversations"}
            </button>
            {conversationPaging.error ? <p className="text-center text-sm text-(--danger)" role="alert">Older conversations could not be loaded. Try again.</p> : null}
          </div>
        ) : null}
      </Card>

      <Card className={!selected ? "hidden lg:block" : "block"}>
        {selected ? (
          <>
            <div className="flex items-center gap-3 border-b border-(--line) p-4">
              <button className="ghost-button lg:hidden" onClick={() => selectConversation(null)} type="button">Back</button>
              <div className="min-w-0">
                <h2 className="truncate text-lg font-semibold tracking-normal">{selected.title}</h2>
                <p className="text-sm text-(--muted)">
                  {selected.requestState === "pending" ? "Message request" : ephemeral.peerTyping ? "Typing…" : selected.muted ? "Notifications muted" : ephemeral.peerOnline ? "Online now" : "Active conversation"}
                </p>
              </div>
            </div>
            <ConversationStateActions conversation={selected} messagesVisible={messages.isSuccess} />
            <CommercialInteractionsPanel conversation={selected} key={selected.id} />
            <div aria-live="polite" className="grid max-h-[52vh] min-h-56 gap-3 overflow-y-auto p-4">
              {messages.isLoading ? <p className="text-sm text-(--muted)">Loading messages…</p> : null}
              {messages.isError ? <EmptyState title="Conversation unavailable">Messages could not be loaded. Try again before treating the thread as read.</EmptyState> : null}
              {messages.data?.nextCursor ? (
                <button className="secondary-button justify-self-center" disabled={selectedMessagePaging.pending} onClick={() => void loadEarlierMessages()} type="button">
                  {selectedMessagePaging.pending ? "Loading…" : "Load earlier messages"}
                </button>
              ) : null}
              {selectedMessagePaging.error ? <p className="text-center text-sm text-(--danger)" role="alert">Earlier messages could not be loaded. Try again.</p> : null}
              {messages.data?.items.length ? messages.data.items.map((message) => (
                <MessageBubble
                  conversationId={selected.id}
                  key={message.id}
                  message={message}
                  onReply={(next) => setReply({ conversationId: selected.id, message: next })}
                />
              )) : !messages.isLoading && !messages.isError ? (
                <EmptyState title="No visible messages yet">Send a respectful introduction to begin.</EmptyState>
              ) : null}
            </div>
            <MessageComposer
              actorUserId={input.actorUserId}
              clientSessionScope={input.clientSessionScope}
              conversation={selected}
              initialSharedContentItemId={input.initialSharedContentItemId}
              key={selected.id}
              onClearReply={() => setReply(null)}
              onTyping={ephemeral.sendTyping}
              replyTo={replyTo}
            />
          </>
        ) : (
          <div className="p-4"><EmptyState title="Select a conversation">Choose a conversation from your inbox.</EmptyState></div>
        )}
      </Card>
    </section>
  );
}

function MessageBubble({ conversationId, message, onReply }: { conversationId: string; message: Message; onReply: (message: Message) => void }) {
  const queryClient = useQueryClient();
  const toggleReaction = async (key: "like" | "love" | "laugh" | "support") => {
    const reacted = message.reactions.some((reaction) => reaction.key === key && reaction.reacted);
    const updated = await updateMessageReaction(conversationId, message.id, key, !reacted);
    queryClient.setQueryData<MessagePage>(
      ["messages", "conversation", conversationId],
      (current) => ({
        items: (current?.items ?? []).map((item) => item.id === updated.id ? updated : item),
        nextCursor: current?.nextCursor ?? null
      })
    );
  };

  return (
    <article className="max-w-[680px] rounded-xl border border-(--line) bg-(--background) p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium">{message.sender.displayName}</p>
        <time className="text-xs text-(--muted)" dateTime={message.createdAt}>
          {new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </time>
      </div>
      {message.replyToMessageId ? <p className="mt-2 border-l-2 border-(--line) pl-2 text-xs text-(--muted)">Reply</p> : null}
      <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{message.body}</p>
      {message.sharedContentItemId ? <a className="mt-2 block text-xs text-(--accent) underline" href={`/content/${encodeURIComponent(message.sharedContentItemId)}`}>Shared WeVid content</a> : null}
      {message.attachments?.length ? (
        <div className="mt-2 flex flex-wrap gap-1" aria-label="Safe media attachments">
          {message.attachments.map((attachment) => (
            <a className="text-xs text-(--accent) underline" href={`/content/${encodeURIComponent(attachment.contentItemId)}`} key={`${attachment.contentItemId}:${attachment.contentRevision}`}>
              Approved attachment · revision {attachment.contentRevision}
            </a>
          ))}
        </div>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-1" aria-label="Message reactions">
        <button className="rounded-full border border-(--line) px-2 py-1 text-xs" onClick={() => onReply(message)} type="button">Reply</button>
        {(["like", "love", "laugh", "support"] as const).map((key) => {
          const reaction = message.reactions.find((item) => item.key === key);
          return (
            <button
              aria-pressed={reaction?.reacted ?? false}
              className={`rounded-full border px-2 py-1 text-xs ${reaction?.reacted ? "border-(--accent) bg-(--accent-soft)" : "border-(--line)"}`}
              key={key}
              onClick={() => void toggleReaction(key)}
              type="button"
            >
              {key}{reaction ? ` ${reaction.count}` : ""}
            </button>
          );
        })}
      </div>
    </article>
  );
}
