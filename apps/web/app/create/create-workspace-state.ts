"use client";

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
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
export const nsfwLabels: CreateContentRequest["nsfwLabel"][] = ["none", "adult", "explicit"];
export const representationModes: CreateContentRequest["representationMode"][] = [
  "self_only",
  "no_real_person",
  "declared_performers"
];

export type PendingState = "publish" | "upload" | "sync" | null;
export type UploadState = "idle" | "uploading" | "complete" | "failed" | "aborted";

export function useCreateWorkspaceState(storageScope: string | null) {
  const localDraftKey = storageScope ? `wevid:create:${storageScope}:draft-v1` : null;
  const [mediaType, setMediaType] = useState<CreateContentRequest["mediaType"]>("clip");
  const [visibility, setVisibility] = useState<CreateContentRequest["visibility"]>("public");
  const [nsfwLabel, setNsfwLabel] = useState<CreateContentRequest["nsfwLabel"]>("none");
  const [representationMode, setRepresentationMode] = useState<CreateContentRequest["representationMode"]>("self_only");
  const [contentSafetyPolicyAccepted, setContentSafetyPolicyAccepted] = useState(false);
  const [caption, setCaption] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [draft, setDraft] = useState<ContentItem | null>(null);
  const [uploadSession, setUploadSession] = useState<UploadSession | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [pending, setPending] = useState<PendingState>(null);
  const [publishState, setPublishState] = useState<"draft" | "submitted_for_review">("draft");
  const [draftStorageReady, setDraftStorageReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const uploadRef = useRef<tus.Upload | null>(null);
  const draftMutationRef = useRef<{ fingerprint: string; idempotencyKey: string } | null>(null);

  useEffect(() => {
    setDraftStorageReady(false);
    if (!localDraftKey) return;
    const saved = window.localStorage.getItem(localDraftKey);
    if (!saved) {
      setDraftStorageReady(true);
      return;
    }
    try {
      const value = JSON.parse(saved) as {
        caption?: string;
        visibility?: CreateContentRequest["visibility"];
        nsfwLabel?: CreateContentRequest["nsfwLabel"];
        representationMode?: CreateContentRequest["representationMode"];
        draftId?: string;
      };
      if (typeof value.caption === "string") setCaption(value.caption);
      if (value.visibility && visibilityValues.includes(value.visibility)) setVisibility(value.visibility);
      if (value.nsfwLabel && nsfwLabels.includes(value.nsfwLabel)) setNsfwLabel(value.nsfwLabel);
      if (value.representationMode && representationModes.includes(value.representationMode)) {
        setRepresentationMode(value.representationMode);
      }
      if (value.draftId) {
        void getContentForMutation(value.draftId).then(setDraft).catch(() => undefined);
      }
    } catch {
      window.localStorage.removeItem(localDraftKey);
    } finally {
      setDraftStorageReady(true);
    }
  }, [localDraftKey]);

  useEffect(() => {
    if (!localDraftKey || !draftStorageReady) return;
    window.localStorage.setItem(localDraftKey, JSON.stringify({
      caption,
      visibility,
      nsfwLabel,
      representationMode,
      draftId: draft?.id
    }));
  }, [caption, visibility, nsfwLabel, representationMode, draft?.id, draftStorageReady, localDraftKey]);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const nextFile = event.currentTarget.files?.[0] ?? null;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(nextFile);
    setPreviewUrl(nextFile ? URL.createObjectURL(nextFile) : null);
    setUploadSession(null);
    setUploadProgress(0);
    setUploadState("idle");
    void uploadRef.current?.abort();
    uploadRef.current = null;
  }

  async function onCreateAndUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) {
      setError("Choose a video to continue.");
      return;
    }
    setPending("upload");
    setError(null);

    try {
      let activeDraft = draft;
      const metadata = currentDraftMetadata();
      const body = {
        mediaType,
        ...metadata
      } satisfies CreateContentRequest;

      if (!activeDraft) {
        const fingerprint = JSON.stringify(body);
        if (draftMutationRef.current?.fingerprint !== fingerprint) {
          draftMutationRef.current = { fingerprint, idempotencyKey: createMutationIdempotencyKey() };
        }
        activeDraft = await createContentDraft(body, draftMutationRef.current.idempotencyKey);
      } else {
        activeDraft = await updateContent(activeDraft.id, metadata);
      }
      setDraft(activeDraft);

      const session = await createMediaUpload({
        contentId: activeDraft.id,
        fileName: file.name,
        mimeType: file.type
      });
      setUploadSession(session);
      setUploadProgress(0);
      startTusUpload(file, session, activeDraft.id);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(null);
    }
  }

  function startTusUpload(fileToUpload: File, session: UploadSession, contentId: string) {
    setError(null);
    setUploadState("uploading");
    setUploadProgress(0);

    const upload = new tus.Upload(fileToUpload, {
      endpoint: session.uploadUrl,
      headers: session.headers ?? {},
      metadata: {
        contentId,
        filename: fileToUpload.name,
        filetype: fileToUpload.type
      },
      onError(nextError) {
        setError(nextError.message || "Upload failed.");
        setUploadState("failed");
      },
      onProgress(bytesSent, bytesTotal) {
        setUploadProgress(bytesTotal > 0 ? Math.round((bytesSent / bytesTotal) * 100) : 0);
      },
      async onSuccess() {
        setUploadProgress(100);
        setUploadState("complete");
        try {
          await syncMediaAsset(session.mediaAssetId);
          setDraft(await getContentForMutation(contentId));
        } catch {
          // Encoding may still be in progress. The user-facing refresh action remains available.
        }
      },
      removeFingerprintOnSuccess: true,
      retryDelays: [0, 3_000, 5_000, 10_000],
      storeFingerprintForResuming: true,
      uploadSize: fileToUpload.size
    });

    uploadRef.current = upload;
    void upload.findPreviousUploads().then((previousUploads) => {
      if (previousUploads[0]) upload.resumeFromPreviousUpload(previousUploads[0]);
      upload.start();
    }).catch((caught: unknown) => {
      setError(caught instanceof Error ? caught.message : "Upload resume failed.");
      setUploadState("failed");
    });
  }

  async function onResumeUpload() {
    if (!file || !uploadSession || !draft) return;
    startTusUpload(file, uploadSession, draft.id);
  }

  async function onAbortUpload() {
    await uploadRef.current?.abort();
    uploadRef.current = null;
    setUploadState("aborted");
  }

  async function onRefreshPreview() {
    if (!draft || !uploadSession) return;
    setPending("sync");
    setError(null);
    try {
      await syncMediaAsset(uploadSession.mediaAssetId);
      setDraft(await getContentForMutation(draft.id));
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
      const updatedDraft = await updateContent(draft.id, currentDraftMetadata());
      setDraft(await publishContent(updatedDraft.id, { confirmation: "submit_for_review" }));
      setPublishState("submitted_for_review");
      if (localDraftKey) window.localStorage.removeItem(localDraftKey);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(null);
    }
  }

  function currentDraftMetadata() {
    return {
      nsfwLabel,
      visibility,
      representationMode,
      contentSafetyPolicyAccepted,
      caption: caption.trim()
    } satisfies UpdateContentRequest;
  }

  return {
    actions: {
      onAbortUpload,
      onCreateAndUpload,
      onFileChange,
      onPublishDraft,
      onRefreshPreview,
      onResumeUpload,
      setCaption,
      setContentSafetyPolicyAccepted,
      setMediaType,
      setNsfwLabel,
      setRepresentationMode,
      setVisibility
    },
    state: {
      caption,
      contentSafetyPolicyAccepted,
      draft,
      error,
      file,
      mediaType,
      nsfwLabel,
      pending,
      previewUrl,
      publishState,
      representationMode,
      uploadProgress,
      uploadSession,
      uploadState,
      visibility
    }
  };
}

function errorMessage(caught: unknown) {
  if (caught instanceof ApiMutationError) return caught.message;
  return "Create action failed.";
}
