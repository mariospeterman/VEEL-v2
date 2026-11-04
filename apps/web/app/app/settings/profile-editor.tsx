"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { safeMutationMessage } from "@/api-errors";
import {
  ApiMutationError,
  updateMyProfile,
  uploadMyProfileAvatar,
  type User
} from "@/api-mutations";

export function ProfileEditor({ initialUser }: { initialUser: User }) {
  const router = useRouter();
  const [handle, setHandle] = useState(initialUser.handle);
  const [displayName, setDisplayName] = useState(initialUser.displayName);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      let avatarUrl = initialUser.avatarUrl ?? null;
      if (avatarFile) {
        if (!["image/jpeg", "image/png", "image/webp"].includes(avatarFile.type)) {
          throw new Error("Profile picture must be JPEG, PNG, or WebP.");
        }
        if (avatarFile.size > 5_000_000) {
          throw new Error("Profile picture must be 5MB or smaller.");
        }
        const uploaded = await uploadMyProfileAvatar({
          contentType: avatarFile.type as "image/jpeg" | "image/png" | "image/webp",
          dataBase64: await fileToBase64(avatarFile),
          fileName: avatarFile.name
        });
        avatarUrl = uploaded.avatarUrl;
      }
      const updated = await updateMyProfile({
        avatarUrl,
        displayName: displayName.trim(),
        handle: handle.trim().toLowerCase()
      });
      setDisplayName(updated.displayName);
      setHandle(updated.handle);
      setAvatarFile(null);
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
      <label className="grid gap-1.5 text-sm">
        <span className="font-medium">Profile picture</span>
        <input
          accept="image/jpeg,image/png,image/webp"
          className="min-h-11 rounded border border-(--line) bg-(--background) px-3 py-2 file:mr-3 file:rounded file:border-0 file:bg-(--glass) file:px-3 file:py-1"
          onChange={(event) => setAvatarFile(event.currentTarget.files?.[0] ?? null)}
          type="file"
        />
        <span className="text-xs text-(--muted)">JPEG, PNG, or WebP up to 5MB.</span>
      </label>
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

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Profile picture could not be read."));
    reader.onload = () => {
      const value = typeof reader.result === "string" ? reader.result : "";
      const base64 = value.split(",", 2)[1];
      if (!base64) reject(new Error("Profile picture could not be read."));
      else resolve(base64);
    };
    reader.readAsDataURL(file);
  });
}
