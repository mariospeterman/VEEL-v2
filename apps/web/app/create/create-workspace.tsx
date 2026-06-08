"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";
import {
  ApiMutationError,
  createContentDraft,
  createMediaUpload,
  type ContentItem,
  type CreateContentRequest,
  type UploadSession
} from "@/api-mutations";

const mediaTypes: CreateContentRequest["mediaType"][] = ["bit", "clip", "vod"];
const visibilityValues: CreateContentRequest["visibility"][] = [
  "public",
  "followers",
  "subscribers",
  "private"
];
const nsfwLabels: CreateContentRequest["nsfwLabel"][] = ["adult", "explicit", "sensitive"];

export function CreateWorkspace() {
  const [mediaType, setMediaType] = useState<CreateContentRequest["mediaType"]>("clip");
  const [visibility, setVisibility] = useState<CreateContentRequest["visibility"]>("private");
  const [nsfwLabel, setNsfwLabel] = useState<CreateContentRequest["nsfwLabel"]>("adult");
  const [caption, setCaption] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [draft, setDraft] = useState<ContentItem | null>(null);
  const [uploadSession, setUploadSession] = useState<UploadSession | null>(null);
  const [pending, setPending] = useState<"draft" | "upload" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onCreateDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending("draft");
    setError(null);

    try {
      const nextDraft = await createContentDraft({
        mediaType,
        nsfwLabel,
        visibility,
        ...(caption.trim() ? { caption: caption.trim() } : {})
      });
      setDraft(nextDraft);
      setUploadSession(null);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(null);
    }
  }

  async function onCreateUploadSession() {
    if (!draft || !file) return;

    setPending("upload");
    setError(null);

    try {
      setUploadSession(
        await createMediaUpload({
          contentId: draft.id,
          fileName: file.name,
          mimeType: file.type
        })
      );
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(null);
    }
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    setFile(event.currentTarget.files?.[0] ?? null);
    setUploadSession(null);
  }

  return (
    <section className="rounded border border-(--line) bg-(--panel) p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-medium text-(--accent)">Workspace</p>
          <h2 className="mt-1 text-lg font-semibold tracking-normal">Draft and upload session</h2>
        </div>
        <span className="rounded bg-(--background) px-2 py-1 text-xs text-(--muted)">
          backend-owned
        </span>
      </div>

      <form className="mt-4 grid gap-3" onSubmit={onCreateDraft}>
        <label className="grid gap-1 text-sm">
          <span className="text-(--muted)">Caption</span>
          <textarea
            className="min-h-24 rounded border border-(--line) bg-(--background) px-3 py-2 text-(--foreground)"
            onChange={(event) => setCaption(event.currentTarget.value)}
            value={caption}
          />
        </label>

        <div className="grid gap-3 sm:grid-cols-3">
          <Select label="Media" onChange={setMediaType} options={mediaTypes} value={mediaType} />
          <Select label="Visibility" onChange={setVisibility} options={visibilityValues} value={visibility} />
          <Select label="Label" onChange={setNsfwLabel} options={nsfwLabels} value={nsfwLabel} />
        </div>

        <button
          className="rounded bg-(--foreground) px-3 py-2 text-sm font-semibold text-(--background) disabled:cursor-not-allowed disabled:opacity-50"
          disabled={pending !== null}
          type="submit"
        >
          {pending === "draft" ? "Creating draft" : "Create server draft"}
        </button>
      </form>

      {draft ? (
        <div className="mt-4 grid gap-3 rounded border border-(--line) bg-(--background) p-3 text-sm">
          <Fact label="Draft" value={draft.id} />
          <Fact label="Access" value={draft.accessState} />
          <Fact label="Playback" value={draft.playback?.state ?? "not_ready"} />
          <label className="grid gap-1">
            <span className="text-(--muted)">Video file</span>
            <input accept="video/mp4,video/quicktime,video/webm" onChange={onFileChange} type="file" />
          </label>
          <button
            className="rounded border border-(--line) px-3 py-2 font-semibold disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!file || pending !== null}
            onClick={onCreateUploadSession}
            type="button"
          >
            {pending === "upload" ? "Creating upload session" : "Create Bunny upload session"}
          </button>
        </div>
      ) : null}

      {uploadSession ? <UploadSessionPanel uploadSession={uploadSession} /> : null}
      {error ? <p className="mt-3 text-sm font-medium text-red-400">{error}</p> : null}
    </section>
  );
}

function UploadSessionPanel({ uploadSession }: { uploadSession: UploadSession }) {
  const headers = Object.entries(uploadSession.headers ?? {});

  return (
    <div className="mt-4 grid gap-3 rounded border border-(--line) bg-(--background) p-3 text-sm">
      <Fact label="Provider" value={uploadSession.provider} />
      <Fact label="Upload URL" value={uploadSession.uploadUrl} />
      <Fact label="Expires" value={uploadSession.expiresAt} />
      <p className="leading-6 text-(--muted)">
        Use these server-issued headers with the Bunny TUS endpoint. The browser never receives the
        Bunny API key, and publish/playback remains blocked until provider status and moderation are
        backend-approved.
      </p>
      <div className="grid gap-2">
        {headers.map(([key, value]) => (
          <Fact key={key} label={key} value={value} />
        ))}
      </div>
    </div>
  );
}

function Select<T extends string>({
  label,
  onChange,
  options,
  value
}: {
  label: string;
  onChange: (value: T) => void;
  options: T[];
  value: T;
}) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="text-(--muted)">{label}</span>
      <select
        className="rounded border border-(--line) bg-(--background) px-3 py-2 text-(--foreground)"
        onChange={(event) => onChange(event.currentTarget.value as T)}
        value={value}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs uppercase text-(--muted)">{label}</p>
      <p className="mt-1 break-words font-medium">{value}</p>
    </div>
  );
}

function errorMessage(caught: unknown) {
  if (caught instanceof ApiMutationError) {
    return caught.message;
  }

  return "Create action failed.";
}
