"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createDirectConversation } from "@/api-mutations";
import { safeMutationMessage } from "@/api-errors";

export function ProfileMessageButton({ userId }: { userId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function openConversation() {
    setPending(true);
    setError(null);
    try {
      const conversation = await createDirectConversation({ targetUserId: userId });
      router.push(`/app/messages?conversation=${encodeURIComponent(conversation.id)}`);
    } catch (reason) {
      setError(safeMutationMessage(reason, "Message"));
      setPending(false);
    }
  }

  return (
    <div className="grid gap-2">
      <button className="secondary-button" disabled={pending} onClick={() => void openConversation()} type="button">
        {pending ? "Opening" : "Message"}
      </button>
      {error ? <p className="text-xs text-(--danger)">{error}</p> : null}
    </div>
  );
}
