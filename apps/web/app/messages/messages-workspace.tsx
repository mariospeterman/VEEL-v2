"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import type { Conversation, Message } from "@/api-client";
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

export function MessagesWorkspace(input: {
  initialConversations: Conversation[];
  initialConversationId: string | null;
  initialMessages: Message[];
  initialMessagesAvailable: boolean;
}) {
  const router = useRouter();
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const conversations = useQuery({
    queryKey: ["messages", "conversations"],
    queryFn: getConversationsForMutation,
    initialData: { items: input.initialConversations }
  });
  const selected = conversations.data.items.find((item) => item.id === input.initialConversationId)
    ?? conversations.data.items[0]
    ?? null;
  const messages = useQuery({
    queryKey: ["messages", "conversation", selected?.id],
    queryFn: () => getConversationMessagesForMutation(selected?.id ?? ""),
    enabled: Boolean(selected),
    retry: 1,
    initialData: selected?.id === input.initialConversationId && input.initialMessagesAvailable
      ? { items: input.initialMessages }
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
            <CommercialInteractionsPanel conversation={selected} />
            <div aria-live="polite" className="grid max-h-[52vh] min-h-56 gap-3 overflow-y-auto p-4">
              {messages.isLoading ? <p className="text-sm text-(--muted)">Loading messages…</p> : null}
              {messages.isError ? <EmptyState title="Conversation unavailable">Messages could not be loaded. Try again before treating the thread as read.</EmptyState> : null}
              {messages.data?.items.length ? messages.data.items.map((message) => (
                <MessageBubble conversationId={selected.id} key={message.id} message={message} onReply={setReplyTo} />
              )) : !messages.isLoading && !messages.isError ? (
                <EmptyState title="No visible messages yet">Send a respectful introduction to begin.</EmptyState>
              ) : null}
            </div>
            <MessageComposer conversation={selected} onClearReply={() => setReplyTo(null)} onTyping={ephemeral.sendTyping} replyTo={replyTo} />
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
    queryClient.setQueryData<{ items: Message[] }>(
      ["messages", "conversation", conversationId],
      (current) => ({ items: (current?.items ?? []).map((item) => item.id === updated.id ? updated : item) })
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
