"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { safeMutationMessage } from "@/api-errors";
import {
  ApiMutationError,
  updateMyProfile,
  type User
} from "@/api-mutations";

export function ProfileEditor({ initialUser }: { initialUser: User }) {
  const router = useRouter();
  const [handle, setHandle] = useState(initialUser.handle);
  const [displayName, setDisplayName] = useState(initialUser.displayName);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const updated = await updateMyProfile({
        displayName: displayName.trim(),
        handle: handle.trim().toLowerCase()
      });
      setDisplayName(updated.displayName);
      setHandle(updated.handle);
      setMessage("Profile saved.");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error && !(reason instanceof ApiMutationError)
        ? reason.message
        : safeMutationMessage(reason, "Profile"));
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="grid gap-4" onSubmit={save}>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1.5 text-sm">
          <span className="font-medium">Handle</span>
          <span className="flex min-h-11 items-center rounded border border-(--line) bg-(--background) px-3 focus-within:ring-2 focus-within:ring-(--accent)">
            <span aria-hidden="true" className="text-(--muted)">@</span>
            <input
              autoComplete="username"
              className="min-w-0 flex-1 bg-transparent px-1 py-2 outline-none"
              maxLength={32}
              minLength={2}
              onChange={(event) => setHandle(event.currentTarget.value.toLowerCase())}
              pattern="[a-z0-9_]{2,32}"
              required
              value={handle}
            />
          </span>
        </label>
        <label className="grid gap-1.5 text-sm">
          <span className="font-medium">Display name</span>
          <input
            className="min-h-11 rounded border border-(--line) bg-(--background) px-3 py-2"
            maxLength={80}
            onChange={(event) => setDisplayName(event.currentTarget.value)}
            required
            value={displayName}
          />
        </label>
      </div>
      <div className="grid gap-1.5 text-sm" role="status">
        <span className="font-medium">Profile picture</span>
        <span className="text-xs text-(--muted)">Photo changes are temporarily unavailable while private image safety is completed. Other profile details can still be saved.</span>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button className="primary-button" disabled={pending} type="submit">
          {pending ? "Saving" : "Save profile"}
        </button>
        <a className="secondary-button" href={`/profile/${encodeURIComponent(handle || initialUser.handle)}`}>View public profile</a>
      </div>
      {message ? <p aria-live="polite" className="text-sm text-(--accent-text)">{message}</p> : null}
      {error ? <p className="text-sm text-(--danger)" role="alert">{error}</p> : null}
    </form>
  );
}
