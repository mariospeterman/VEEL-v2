"use client";

import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import * as tus from "tus-js-client";
import { createMutationIdempotencyKey } from "@/api-mutation-transport";
import {
  ApiMutationError,
  createContentDraft,
  createMediaUpload,
  getContentForMutation,
  publishContent,
  syncMediaAsset,
  updateContent,
  type ContentItem,
  type CreateContentRequest,
  type UpdateContentRequest,
  type UploadSession
} from "@/api-mutations";

export const mediaTypes: CreateContentRequest["mediaType"][] = ["bit", "clip", "vod"];
export const visibilityValues: CreateContentRequest["visibility"][] = [
  "public",
  "followers",
  "subscribers",
  "private"
];
export const nsfwLabels: CreateContentRequest["nsfwLabel"][] = ["adult", "explicit", "sensitive"];

export type PendingState = "draft" | "save" | "publish" | "upload" | "sync" | null;
export type UploadState = "idle" | "uploading" | "complete" | "failed" | "aborted";

export function useCreateWorkspaceState() {
  const [mediaType, setMediaType] = useState<CreateContentRequest["mediaType"]>("clip");
  const [visibility, setVisibility] = useState<CreateContentRequest["visibility"]>("private");
  const [nsfwLabel, setNsfwLabel] = useState<CreateContentRequest["nsfwLabel"]>("adult");
  const [caption, setCaption] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [draft, setDraft] = useState<ContentItem | null>(null);
  const [uploadSession, setUploadSession] = useState<UploadSession | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);
  const [teaserStartMs, setTeaserStartMs] = useState("");
  const [teaserEndMs, setTeaserEndMs] = useState("");
  const [thumbnailFrameMs, setThumbnailFrameMs] = useState("");
  const [pending, setPending] = useState<PendingState>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [publishState, setPublishState] = useState<"draft" | "submitted_for_review">("draft");
  const [providerSyncedAt, setProviderSyncedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const uploadRef = useRef<tus.Upload | null>(null);
  const draftMutationRef = useRef<{ fingerprint: string; idempotencyKey: string } | null>(null);

  async function onCreateDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending("draft");
    setError(null);

    try {
      const draftBody = {
        mediaType,
        nsfwLabel,
        visibility,
        ...(caption.trim() ? { caption: caption.trim() } : {})
      } satisfies CreateContentRequest;
      const fingerprint = JSON.stringify(draftBody);
      if (draftMutationRef.current?.fingerprint !== fingerprint) {
        draftMutationRef.current = {
          fingerprint,
          idempotencyKey: createMutationIdempotencyKey()
        };
      }
      const nextDraft = await createContentDraft(
        draftBody,
        draftMutationRef.current.idempotencyKey
      );
      setDraft(nextDraft);
      setUploadSession(null);
      setSavedAt(new Date().toISOString());
      setPublishState("draft");
      setProviderSyncedAt(null);
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
      setDraft(await publishContent(draft.id, { confirmation: "submit_for_review" }));
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
      setProviderSyncedAt(null);
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

  async function onSyncProviderStatus() {
    if (!draft || !uploadSession) return;
    setPending("sync");
    setError(null);

    try {
      await syncMediaAsset(uploadSession.mediaAssetId);
      setDraft(await getContentForMutation(draft.id));
      setProviderSyncedAt(new Date().toISOString());
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(null);
    }
  }

  return {
    actions: {
      onAbortUpload,
      onCreateDraft,
      onCreateUploadSession,
      onFileChange,
      onPublishDraft,
      onSaveDraftSettings,
      onStartUpload,
      onSyncProviderStatus,
      setCaption,
      setMediaType,
      setNsfwLabel,
      setTeaserEndMs,
      setTeaserStartMs,
      setThumbnailFrameMs,
      setVisibility
    },
    state: {
      caption,
      draft,
      error,
      file,
      mediaType,
      nsfwLabel,
      pending,
      providerSyncedAt,
      publishState,
      savedAt,
      teaserEndMs,
      teaserStartMs,
      thumbnailFrameMs,
      uploadProgress,
      uploadSession,
      uploadState,
      uploadedUrl,
      visibility
    }
  };
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
