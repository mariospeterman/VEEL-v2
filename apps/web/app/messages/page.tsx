import type { components } from "@veel/contracts";
import { appShellNavItems } from "@veel/ui";

type Conversation = components["schemas"]["Conversation"];
type Message = components["schemas"]["Message"];

const creator = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaab20",
  handle: "maki",
  displayName: "Maki",
  avatarUrl: null,
  badges: []
};

const conversation: Conversation = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaab10",
  type: "direct",
  title: "Maki",
  unreadCount: 1,
  lastMessage: {
    body: "Paid hello is waiting for settlement.",
    sender: creator,
    createdAt: "2026-06-04T23:45:00.000Z"
  }
};

const visibleMessage: Message = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaab90",
  conversationId: conversation.id,
  sender: creator,
  body: "Visible message",
  deliveryState: "visible",
  paymentIntentId: null,
  createdAt: "2026-06-04T23:45:00.000Z"
};

const paidDraft: Message = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaab91",
  conversationId: conversation.id,
  sender: creator,
  body: "Paid hello",
  deliveryState: "pending_payment",
  paymentIntentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaab50",
  createdAt: "2026-06-04T23:46:00.000Z"
};

export default function MessagesPage() {
  return (
    <main className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <nav className="mx-auto flex w-full max-w-6xl items-center justify-between border-b border-[var(--line)] px-5 py-4">
        <a className="text-lg font-semibold tracking-normal" href="/">
          VEEL
        </a>
        <div className="flex gap-1">
          {appShellNavItems.map((item) => (
            <a
              className="rounded px-3 py-2 text-sm text-[var(--muted)] transition hover:bg-[var(--panel)] hover:text-[var(--foreground)]"
              href={item.href}
              key={item.href}
            >
              {item.label}
            </a>
          ))}
        </div>
      </nav>

      <section className="mx-auto grid w-full max-w-6xl gap-5 px-5 py-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="rounded border border-[var(--line)] bg-[var(--panel)]">
          <div className="border-b border-[var(--line)] p-4">
            <p className="text-sm font-medium text-[var(--accent)]">Messages</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-normal">Inbox</h1>
          </div>
          <article className="grid gap-1 border-b border-[var(--line)] p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="font-medium">{conversation.title}</p>
              <span className="rounded bg-[var(--accent-soft)] px-2 py-1 text-xs font-semibold text-[var(--accent-strong)]">
                {conversation.unreadCount}
              </span>
            </div>
            <p className="truncate text-sm text-[var(--muted)]">{conversation.lastMessage?.body}</p>
          </article>
        </aside>

        <section className="rounded border border-[var(--line)] bg-[var(--panel)]">
          <div className="border-b border-[var(--line)] p-4">
            <h2 className="text-lg font-semibold tracking-normal">{conversation.title}</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">Direct conversation</p>
          </div>

          <div className="grid gap-3 p-4">
            <MessageBubble message={visibleMessage} />
            <MessageBubble message={paidDraft} />
          </div>
        </section>
      </section>
    </main>
  );
}

function MessageBubble({ message }: { message: Message }) {
  return (
    <article className="max-w-[640px] rounded border border-[var(--line)] bg-[var(--background)] p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium">{message.sender.displayName}</p>
        <span className="rounded bg-[var(--panel)] px-2 py-1 text-xs text-[var(--muted)]">
          {message.deliveryState}
        </span>
      </div>
      <p className="mt-2 text-sm leading-6">{message.body}</p>
    </article>
  );
}
