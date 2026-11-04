export function findSelectedConversation<T extends { id: string }>(
  conversations: T[],
  conversationId: string | null | undefined
): T | null {
  if (!conversationId) return null;
  return conversations.find((conversation) => conversation.id === conversationId) ?? null;
}

export function replyForConversation<T>(
  reply: { conversationId: string; message: T } | null,
  conversationId: string | null | undefined
): T | null {
  return reply && conversationId && reply.conversationId === conversationId ? reply.message : null;
}

export function conversationReadAttemptKey(
  conversation: { id: string; requestState: string; unreadCount: number },
  messagesVisible: boolean
): string | null {
  if (!messagesVisible || conversation.requestState === "pending" || conversation.unreadCount < 1) {
    return null;
  }
  return `${conversation.id}:${conversation.unreadCount}`;
}
