"use client";

import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import * as tus from "tus-js-client";
import {
  ApiMutationError,
  createContentDraft,
  createMediaUpload,
  publishContent,
  updateContent,
  type ContentItem,
  type CreateContentRequest,
  type UpdateContentRequest,
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
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadState, setUploadState] = useState<"idle" | "uploading" | "complete" | "failed" | "aborted">("idle");
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);
  const [teaserStartMs, setTeaserStartMs] = useState("");
  const [teaserEndMs, setTeaserEndMs] = useState("");
  const [thumbnailFrameMs, setThumbnailFrameMs] = useState("");
  const [pending, setPending] = useState<"draft" | "save" | "publish" | "upload" | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [publishState, setPublishState] = useState<"draft" | "submitted_for_review">("draft");
  const [error, setError] = useState<string | null>(null);
  const uploadRef = useRef<tus.Upload | null>(null);

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
      setSavedAt(new Date().toISOString());
      setPublishState("draft");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(null);
    }
  }

  async function onPublishDraft() {
    if (!draft) return;

    setPending("publish");
    setError(null);

    try {
      setDraft(
        await publishContent(draft.id, {
          confirmation: "submit_for_review"
        })
      );
      setPublishState("submitted_for_review");
      setSavedAt(new Date().toISOString());
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(null);
    }
  }

  async function onSaveDraftSettings() {
    if (!draft) return;

    setPending("save");
    setError(null);

    try {
      const body: UpdateContentRequest = {
        caption,
        visibility,
        nsfwLabel,
        teaserStartMs: numericControlValue(teaserStartMs),
        teaserEndMs: numericControlValue(teaserEndMs),
        thumbnailFrameMs: numericControlValue(thumbnailFrameMs)
      };
      setDraft(await updateContent(draft.id, body));
      setSavedAt(new Date().toISOString());
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
      setUploadProgress(0);
      setUploadState("idle");
      setUploadedUrl(null);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(null);
    }
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    setFile(event.currentTarget.files?.[0] ?? null);
    setUploadSession(null);
    setUploadProgress(0);
    setUploadState("idle");
    setUploadedUrl(null);
    void uploadRef.current?.abort();
    uploadRef.current = null;
  }

  async function onStartUpload() {
    if (!file || !uploadSession) return;

    setError(null);
    setUploadState("uploading");
    setUploadProgress(0);
    setUploadedUrl(null);

    const upload = new tus.Upload(file, {
      endpoint: uploadSession.uploadUrl,
      headers: uploadSession.headers ?? {},
      metadata: {
        contentId: draft?.id ?? "",
        filename: file.name,
        filetype: file.type
      },
      onError(nextError) {
        setError(nextError.message || "Upload failed.");
        setUploadState("failed");
      },
      onProgress(bytesSent, bytesTotal) {
        setUploadProgress(bytesTotal > 0 ? Math.round((bytesSent / bytesTotal) * 100) : 0);
      },
      onSuccess() {
        setUploadedUrl(upload.url);
        setUploadProgress(100);
        setUploadState("complete");
      },
      removeFingerprintOnSuccess: true,
      retryDelays: [0, 3_000, 5_000, 10_000],
      storeFingerprintForResuming: true,
      uploadSize: file.size
    });

    uploadRef.current = upload;

    try {
      const previousUploads = await upload.findPreviousUploads();

      if (previousUploads.length > 0 && previousUploads[0]) {
        upload.resumeFromPreviousUpload(previousUploads[0]);
      }

      upload.start();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Upload resume failed.");
      setUploadState("failed");
    }
  }

  async function onAbortUpload() {
    await uploadRef.current?.abort();
    uploadRef.current = null;
    setUploadState("aborted");
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
          <Fact label="Visibility" value={visibility} />
          <Fact label="Label" value={nsfwLabel} />
          <Fact label="Publish" value={publishState} />
          {savedAt ? <Fact label="Last saved" value={savedAt} /> : null}
          <div className="grid gap-3 sm:grid-cols-3">
            <NumberInput label="Teaser start ms" onChange={setTeaserStartMs} value={teaserStartMs} />
            <NumberInput label="Teaser end ms" onChange={setTeaserEndMs} value={teaserEndMs} />
            <NumberInput label="Thumbnail frame ms" onChange={setThumbnailFrameMs} value={thumbnailFrameMs} />
          </div>
          <button
            className="rounded border border-(--line) px-3 py-2 font-semibold disabled:cursor-not-allowed disabled:opacity-50"
            disabled={pending !== null}
            onClick={onSaveDraftSettings}
            type="button"
          >
            {pending === "save" ? "Saving settings" : "Save draft settings"}
          </button>
          <button
            className="rounded bg-(--foreground) px-3 py-2 font-semibold text-(--background) disabled:cursor-not-allowed disabled:opacity-50"
            disabled={pending !== null || uploadState !== "complete" || publishState === "submitted_for_review"}
            onClick={onPublishDraft}
            type="button"
          >
            {pending === "publish" ? "Submitting for review" : "Submit for review"}
          </button>
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

      {uploadSession ? (
        <UploadSessionPanel
          onAbortUpload={onAbortUpload}
          onStartUpload={onStartUpload}
          uploadProgress={uploadProgress}
          uploadSession={uploadSession}
          uploadState={uploadState}
          uploadedUrl={uploadedUrl}
        />
      ) : null}
      {error ? <p className="mt-3 text-sm font-medium text-red-400">{error}</p> : null}
    </section>
  );
}

function UploadSessionPanel({
  onAbortUpload,
  onStartUpload,
  uploadProgress,
  uploadSession,
  uploadState,
  uploadedUrl
}: {
  onAbortUpload: () => Promise<void>;
  onStartUpload: () => Promise<void>;
  uploadProgress: number;
  uploadSession: UploadSession;
  uploadState: "idle" | "uploading" | "complete" | "failed" | "aborted";
  uploadedUrl: string | null;
}) {
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
        <div className="h-2 overflow-hidden rounded bg-(--line)">
          <div className="h-full bg-(--accent)" style={{ width: `${uploadProgress}%` }} />
        </div>
        <Fact label="Upload state" value={`${uploadState} ${uploadProgress}%`} />
        {uploadedUrl ? <Fact label="TUS upload URL" value={uploadedUrl} /> : null}
        <div className="flex flex-wrap gap-2">
          <button
            className="rounded bg-(--foreground) px-3 py-2 font-semibold text-(--background) disabled:cursor-not-allowed disabled:opacity-50"
            disabled={uploadState === "uploading" || uploadState === "complete"}
            onClick={onStartUpload}
            type="button"
          >
            {uploadState === "aborted" || uploadState === "failed" ? "Resume upload" : "Start upload"}
          </button>
          <button
            className="rounded border border-(--line) px-3 py-2 font-semibold disabled:cursor-not-allowed disabled:opacity-50"
            disabled={uploadState !== "uploading"}
            onClick={onAbortUpload}
            type="button"
          >
            Pause
          </button>
        </div>
      </div>
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

function NumberInput({
  label,
  onChange,
  value
}: {
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="text-(--muted)">{label}</span>
      <input
        className="rounded border border-(--line) bg-(--background) px-3 py-2 text-(--foreground)"
        min="0"
        onChange={(event) => onChange(event.currentTarget.value)}
        type="number"
        value={value}
      />
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

function numericControlValue(value: string) {
  if (!value.trim()) {
    return null;
  }

  return Number.parseInt(value, 10);
}
