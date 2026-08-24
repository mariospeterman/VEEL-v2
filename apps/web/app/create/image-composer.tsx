"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import * as tus from "tus-js-client";
import type { VerificationStatus } from "@/api-client";
import { createMutationIdempotencyKey } from "@/api-mutation-transport";
import {
  ApiMutationError,
  createContentDraft,
  createMediaUpload,
  getContentForMutation,
  publishContent,
  retireContentMediaAsset,
  syncMediaAsset,
  updateContent,
  updateContentMediaAsset,
  uploadContentImageAsset,
  type ContentItem,
  type CreateContentRequest,
  type UploadSession
} from "@/api-mutations";
import { Select } from "./create-workspace-fields";
import { AdultPublisherGate } from "../app/create/adult-publisher-gate";
import { nsfwLabels, representationModes, visibilityValues } from "./composer-options";

type Origin = "human_created" | "ai_assisted" | "ai_generated" | "materially_ai_manipulated";
type LocalAsset = {
  key: string;
  kind: "image" | "video";
  file: File;
  previewUrl: string;
  altText: string;
  originClassification: Origin;
  mediaAssetId?: string;
  uploadSession?: UploadSession;
  transferComplete?: boolean;
};

const acceptedImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const acceptedVideoTypes = new Set(["video/mp4", "video/quicktime", "video/webm"]);
const acceptedMediaTypes = new Set([...acceptedImageTypes, ...acceptedVideoTypes]);
const origins: Origin[] = ["human_created", "ai_assisted", "ai_generated", "materially_ai_manipulated"];
const singleVideoTypes: Array<"bit" | "clip" | "vod"> = ["bit", "clip", "vod"];

export function MediaAssetComposer({
  storageScope,
  verification
}: {
  storageScope: string | null;
  verification: VerificationStatus | null;
}) {
  const [assets, setAssets] = useState<LocalAsset[]>([]);
  const [caption, setCaption] = useState("");
  const [visibility, setVisibility] = useState<CreateContentRequest["visibility"]>("public");
  const [nsfwLabel, setNsfwLabel] = useState<CreateContentRequest["nsfwLabel"]>("none");
  const [representationMode, setRepresentationMode] = useState<CreateContentRequest["representationMode"]>("self_only");
  const [accepted, setAccepted] = useState(false);
  const [draft, setDraft] = useState<ContentItem | null>(null);
  const [pending, setPending] = useState<"upload" | "reorder" | "details" | "remove" | "publish" | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [singleVideoType, setSingleVideoType] = useState<(typeof singleVideoTypes)[number]>("clip");
  const uploadKeys = useRef(new Map<string, string>());
  const removalKeys = useRef(new Map<string, string>());
  const previewUrls = useRef(new Set<string>());
  const activeUpload = useRef<tus.Upload | null>(null);
  const pauseCurrentUpload = useRef<(() => void) | null>(null);
  const draftKey = storageScope ? `wevid:create:${storageScope}:media-draft-v2` : null;
  const allUploaded = assets.length > 0 && assets.every((asset) => asset.mediaAssetId && asset.transferComplete);
  const ageReady = verification?.capabilities.canUploadMedia === true;
  const adultSelected = nsfwLabel !== "none";
  const adultPublishReady = verification?.capabilities.canPublishAdultMedia === true;

  useEffect(() => () => {
    for (const previewUrl of previewUrls.current) URL.revokeObjectURL(previewUrl);
    previewUrls.current.clear();
  }, []);

  useEffect(() => {
    if (!draftKey) return;
    const saved = window.localStorage.getItem(draftKey);
    if (!saved) return;
    try {
      const value = JSON.parse(saved) as {
        draftId?: string;
        caption?: string;
        visibility?: CreateContentRequest["visibility"];
        nsfwLabel?: CreateContentRequest["nsfwLabel"];
        representationMode?: CreateContentRequest["representationMode"];
        singleVideoType?: (typeof singleVideoTypes)[number];
      };
      if (typeof value.caption === "string") setCaption(value.caption);
      if (value.visibility && visibilityValues.includes(value.visibility)) setVisibility(value.visibility);
      if (value.nsfwLabel && nsfwLabels.includes(value.nsfwLabel)) setNsfwLabel(value.nsfwLabel);
      if (value.representationMode && representationModes.includes(value.representationMode)) {
        setRepresentationMode(value.representationMode);
      }
      if (value.singleVideoType && singleVideoTypes.includes(value.singleVideoType)) {
        setSingleVideoType(value.singleVideoType);
      }
      if (value.draftId) void getContentForMutation(value.draftId).then(setDraft).catch(() => undefined);
    } catch {
      window.localStorage.removeItem(draftKey);
    }
  }, [draftKey]);

  useEffect(() => {
    if (!draftKey) return;
    window.localStorage.setItem(draftKey, JSON.stringify({
      draftId: draft?.id,
      caption,
      visibility,
      nsfwLabel,
      representationMode,
      singleVideoType
    }));
  }, [caption, draft?.id, draftKey, nsfwLabel, representationMode, singleVideoType, visibility]);

  const formatLabel = useMemo(() => {
    if (assets.length > 1) return "Carousel";
    return assets[0]?.kind === "video" ? "Video" : "Photo";
  }, [assets]);

  function onFiles(event: ChangeEvent<HTMLInputElement>) {
    const selected = [...(event.currentTarget.files ?? [])];
    event.currentTarget.value = "";
    const invalid = selected.find((file) => !acceptedMediaTypes.has(file.type));
    if (invalid || selected.length === 0 || assets.length + selected.length > 10) {
      setError("Choose up to 10 JPEG, PNG, WebP, MP4, MOV, or WebM files.");
      return;
    }
    const additions = selected.map((file) => {
      const previewUrl = URL.createObjectURL(file);
      previewUrls.current.add(previewUrl);
      return {
        key: `${file.name}:${file.size}:${file.lastModified}:${crypto.randomUUID()}`,
        kind: acceptedImageTypes.has(file.type) ? "image" as const : "video" as const,
        file,
        previewUrl,
        altText: "",
        originClassification: "human_created" as Origin
      };
    });
    const next = [...assets, ...additions];
    if (draft && !assetsCompatibleWithDraft(next, draft.mediaType)) {
      for (const asset of additions) {
        URL.revokeObjectURL(asset.previewUrl);
        previewUrls.current.delete(asset.previewUrl);
      }
      setError("This saved draft can only replace assets of its original format.");
      return;
    }
    setAssets(next);
    setProgress(0);
    setAccepted(false);
    setSubmitted(false);
    setError(null);
    setNotice(null);
  }

  async function onUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (assets.length === 0) return setError("Choose at least one photo or video.");
    if (assets.some((asset) => !asset.altText.trim())) return setError("Add a description for every item.");
    if (!accepted) return setError("Confirm the rights and safety declaration.");
    setPending("upload");
    setError(null);
    try {
      let activeDraft = draft;
      if (!activeDraft) {
        activeDraft = await createContentDraft({
          mediaType: mediaTypeFor(assets, singleVideoType),
          caption: caption.trim(),
          visibility,
          nsfwLabel,
          representationMode,
          contentSafetyPolicyAccepted: true
        }, createMutationIdempotencyKey());
        setDraft(activeDraft);
      }

      const nextAssets = [...assets];
      for (const [index, localAsset] of nextAssets.entries()) {
        if (localAsset.mediaAssetId && localAsset.transferComplete) continue;
        let idempotencyKey = uploadKeys.current.get(localAsset.key);
        if (!idempotencyKey) {
          idempotencyKey = createMutationIdempotencyKey();
          uploadKeys.current.set(localAsset.key, idempotencyKey);
        }
        let mediaAssetId: string;
        if (localAsset.kind === "image") {
          const uploaded = await uploadContentImageAsset(activeDraft.id, localAsset.file, idempotencyKey);
          mediaAssetId = uploaded.mediaAssetId;
        } else {
          let uploadSession = localAsset.uploadSession;
          if (!uploadSession) {
            uploadSession = await createMediaUpload({
              contentId: activeDraft.id,
              fileName: localAsset.file.name,
              mimeType: localAsset.file.type
            }, idempotencyKey);
            nextAssets[index] = { ...localAsset, mediaAssetId: uploadSession.mediaAssetId, uploadSession };
            setAssets([...nextAssets]);
          }
          mediaAssetId = uploadSession.mediaAssetId;
          await uploadVideo(localAsset.file, uploadSession, activeDraft.id, (assetProgress) => {
            setProgress(Math.round(((index + assetProgress / 100) / nextAssets.length) * 100));
          }, activeUpload, pauseCurrentUpload);
          try {
            await syncMediaAsset(mediaAssetId);
          } catch {
            // Provider encoding can continue after the resumable transfer completes.
          }
        }
        let refreshed = await getContentForMutation(activeDraft.id);
        const updated = await updateContentMediaAsset(mediaAssetId, {
          expectedCompositionRevision: refreshed.compositionRevision ?? 1,
          altText: localAsset.altText.trim(),
          originClassification: localAsset.originClassification
        });
        nextAssets[index] = {
          ...nextAssets[index]!,
          mediaAssetId,
          transferComplete: true
        };
        setAssets([...nextAssets]);
        setProgress(Math.round(((index + 1) / nextAssets.length) * 100));
        refreshed = { ...refreshed, compositionRevision: updated.compositionRevision };
        activeDraft = refreshed;
        setDraft(refreshed);
      }
      setDraft(await getContentForMutation(activeDraft.id));
    } catch (caught) {
      if (caught instanceof UploadPausedError) {
        setNotice("Upload paused. Resume when you are ready.");
      } else {
        setError(messageFor(caught));
      }
    } finally {
      setPending(null);
    }
  }

  async function moveAsset(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= assets.length) return;
    const next = [...assets];
    [next[index], next[target]] = [next[target]!, next[index]!];
    setAssets(next);
    if (!draft || !next.every((asset) => asset.mediaAssetId)) return;
    setPending("reorder");
    setError(null);
    try {
      setDraft(await updateContent(draft.id, {
        expectedCompositionRevision: draft.compositionRevision ?? 1,
        assetOrder: next.map((asset) => asset.mediaAssetId!)
      }));
    } catch (caught) {
      setAssets(assets);
      setError(messageFor(caught));
    } finally {
      setPending(null);
    }
  }

  async function saveAssetDetails(asset: LocalAsset) {
    if (!draft || !asset.mediaAssetId) return;
    setPending("details");
    setError(null);
    setNotice(null);
    try {
      const updated = await updateContentMediaAsset(asset.mediaAssetId, {
        expectedCompositionRevision: draft.compositionRevision ?? 1,
        altText: asset.altText.trim(),
        originClassification: asset.originClassification
      });
      setDraft({ ...draft, compositionRevision: updated.compositionRevision });
      setNotice("Media details saved.");
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setPending(null);
    }
  }

  async function removeAsset(asset: LocalAsset) {
    if (!asset.mediaAssetId) {
      URL.revokeObjectURL(asset.previewUrl);
      previewUrls.current.delete(asset.previewUrl);
      setAssets((current) => current.filter((item) => item.key !== asset.key));
      return;
    }
    if (!draft) return;
    let idempotencyKey = removalKeys.current.get(asset.mediaAssetId);
    if (!idempotencyKey) {
      idempotencyKey = createMutationIdempotencyKey();
      removalKeys.current.set(asset.mediaAssetId, idempotencyKey);
    }
    setPending("remove");
    setError(null);
    setNotice(null);
    try {
      const removed = await retireContentMediaAsset(asset.mediaAssetId, {
        expectedCompositionRevision: draft.compositionRevision ?? 1,
        reason: "creator_removed"
      }, idempotencyKey);
      URL.revokeObjectURL(asset.previewUrl);
      previewUrls.current.delete(asset.previewUrl);
      setAssets((current) => current.filter((item) => item.key !== asset.key));
      setDraft({ ...draft, compositionRevision: removed.compositionRevision });
      setNotice(removed.cleanupState === "completed"
        ? "Media removed."
        : "Media removed. We’ll finish clearing the private copy automatically.");
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setPending(null);
    }
  }

  async function onPublish() {
    if (!draft) return;
    if (!accepted) {
      setError("Confirm the rights and safety declaration.");
      return;
    }
    setPending("publish");
    setError(null);
    try {
      const updated = await updateContent(draft.id, {
        caption: caption.trim(), visibility, nsfwLabel, representationMode,
        contentSafetyPolicyAccepted: true
      });
      setDraft(await publishContent(updated.id, { confirmation: "submit_for_review" }));
      setSubmitted(true);
      if (draftKey) window.localStorage.removeItem(draftKey);
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setPending(null);
    }
  }

  return (
    <section className="overflow-hidden rounded border border-(--line) bg-(--panel)">
      <form className="grid gap-5 p-4 sm:p-5" onSubmit={onUpload}>
        <div>
          <p className="text-sm font-medium text-(--accent-text)">{formatLabel}</p>
          <h2 className="mt-1 text-lg font-semibold">Add photos or videos</h2>
          <p className="mt-1 text-sm leading-6 text-(--muted)">Choose once for a single post or mixed carousel. Everything stays private until review.</p>
        </div>
        <label className="grid min-h-32 cursor-pointer place-items-center rounded border border-dashed border-(--line) bg-(--background) p-6 text-center focus-within:ring-2 focus-within:ring-(--accent)">
          <span><span className="block font-semibold">{assets.length ? "Add more media" : "Choose 1–10 photos or videos"}</span><span className="mt-1 block text-sm text-(--muted)">JPEG, PNG, WebP, MP4, MOV, or WebM</span></span>
          <input accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm" className="sr-only" disabled={pending !== null || submitted || assets.length >= 10} multiple onChange={onFiles} type="file" />
        </label>

        {assets.length === 1 && assets[0]?.kind === "video" && !draft ? <Select label="Video format" onChange={(value) => setSingleVideoType(value)} optionLabel={videoTypeLabel} options={singleVideoTypes} value={singleVideoType} /> : null}

        {assets.length > 0 ? <ol aria-label="Media order" className="grid gap-3 sm:grid-cols-2">
          {assets.map((asset, index) => <li className="grid gap-3 rounded border border-(--line) bg-(--background) p-3" key={asset.key}>
            {asset.kind === "image" ? <img alt="" className="aspect-square w-full rounded bg-black object-contain" src={asset.previewUrl} /> : <video aria-label={`Video ${index + 1} preview`} className="aspect-square w-full rounded bg-black object-contain" controls muted playsInline src={asset.previewUrl} />}
            <div className="flex items-center justify-between gap-2 text-sm"><span className="font-semibold">{asset.kind === "image" ? "Photo" : "Video"} {index + 1}</span><span className="text-(--muted)">{asset.transferComplete ? "Stored privately" : asset.mediaAssetId ? "Upload resumable" : "Not uploaded"}</span></div>
            <label className="grid gap-1 text-sm"><span className="text-(--muted)">Description</span><textarea className="min-h-20 rounded border border-(--line) bg-(--panel) px-3 py-2" maxLength={1000} onChange={(event) => { const altText = event.currentTarget.value; setAssets((current) => current.map((item) => item.key === asset.key ? { ...item, altText } : item)); }} value={asset.altText} /></label>
            <Select label="How was this made?" onChange={(originClassification) => setAssets((current) => current.map((item) => item.key === asset.key ? { ...item, originClassification } : item))} optionLabel={originLabel} options={origins} value={asset.originClassification} />
            <div className="flex flex-wrap gap-2"><button aria-label={`Move item ${index + 1} earlier`} className="rounded border border-(--line) px-3 py-2 text-sm disabled:opacity-40" disabled={index === 0 || pending !== null} onClick={() => void moveAsset(index, -1)} type="button">Earlier</button><button aria-label={`Move item ${index + 1} later`} className="rounded border border-(--line) px-3 py-2 text-sm disabled:opacity-40" disabled={index === assets.length - 1 || pending !== null} onClick={() => void moveAsset(index, 1)} type="button">Later</button>{asset.mediaAssetId && asset.transferComplete ? <button className="rounded border border-(--line) px-3 py-2 text-sm disabled:opacity-40" disabled={pending !== null || !asset.altText.trim()} onClick={() => void saveAssetDetails(asset)} type="button">Save details</button> : null}<button className="ml-auto rounded border border-(--line) px-3 py-2 text-sm disabled:opacity-40" disabled={pending !== null} onClick={() => void removeAsset(asset)} type="button">{pending === "remove" ? "Removing…" : "Remove"}</button></div>
          </li>)}
        </ol> : null}

        {assets.length > 0 ? <>
          <label className="grid gap-1 text-sm"><span className="font-medium">Caption</span><textarea className="min-h-24 rounded border border-(--line) bg-(--background) px-3 py-2" maxLength={2200} onChange={(event) => setCaption(event.currentTarget.value)} value={caption} /></label>
          <div className="grid gap-3 sm:grid-cols-2"><Select label="Content rating" onChange={(value) => { setNsfwLabel(value); setAccepted(false); }} options={nsfwLabels} value={nsfwLabel} /><Select label="Who can see it after approval?" onChange={setVisibility} options={visibilityValues} value={visibility} /><Select label="Who is represented?" onChange={(value) => { setRepresentationMode(value); setAccepted(false); }} options={representationModes} value={representationMode} /></div>
          <label className="flex min-h-12 items-start gap-3 rounded border border-(--line) bg-(--background) p-3 text-sm leading-5"><input checked={accepted} className="mt-0.5" onChange={(event) => setAccepted(event.currentTarget.checked)} type="checkbox" /><span>I have the right to share this media, and every identifiable person is 18+ and consented.</span></label>
          <div className="flex flex-wrap gap-2"><button className="min-h-12 flex-1 rounded bg-(--foreground) px-4 py-3 font-semibold text-(--background) disabled:opacity-50" disabled={!ageReady || !accepted || pending !== null || allUploaded} type="submit">{pending === "upload" ? `Uploading ${progress}%…` : allUploaded ? "Media stored privately" : assets.some((asset) => asset.mediaAssetId && !asset.transferComplete) ? "Resume upload" : "Upload media"}</button>{pending === "upload" && activeUpload.current ? <button className="min-h-12 rounded border border-(--line) px-4 py-3 font-semibold" onClick={() => { void activeUpload.current?.abort().finally(() => pauseCurrentUpload.current?.()); }} type="button">Pause</button> : null}</div>
        </> : null}
      </form>

      {allUploaded ? <section aria-live="polite" className="grid gap-3 border-t border-(--line) p-4 sm:p-5"><p className="text-sm leading-6 text-(--muted)">Upload complete. Publication stays blocked until every safety review returns complete release evidence.</p>{adultSelected && !adultPublishReady ? <AdultPublisherGate verification={verification} /> : null}<button className="justify-self-start rounded bg-(--foreground) px-4 py-2 text-sm font-semibold text-(--background) disabled:opacity-50" disabled={pending !== null || submitted || !accepted || (adultSelected && !adultPublishReady)} onClick={() => void onPublish()} type="button">{pending === "publish" ? "Checking readiness…" : submitted ? "Submitted for review" : "Review and submit"}</button></section> : null}
      {notice ? <p className="border-t border-(--line) p-4 text-sm font-medium text-(--muted)" role="status">{notice}</p> : null}
      {error ? <p className="border-t border-(--line) p-4 text-sm font-medium text-red-400" role="alert">{error}</p> : null}
    </section>
  );
}

function originLabel(value: Origin) {
  return ({ human_created: "Created by me", ai_assisted: "AI-assisted", ai_generated: "AI-generated", materially_ai_manipulated: "Materially AI-edited" } as const)[value];
}

function videoTypeLabel(value: string) {
  return ({ bit: "Bit", clip: "Clip", vod: "Long video" } as const)[value as "bit" | "clip" | "vod"] ?? value;
}

function mediaTypeFor(assets: LocalAsset[], singleVideoType: (typeof singleVideoTypes)[number]): CreateContentRequest["mediaType"] {
  if (assets.length > 1) return "carousel";
  return assets[0]?.kind === "video" ? singleVideoType : "image";
}

function assetsCompatibleWithDraft(assets: LocalAsset[], mediaType: ContentItem["mediaType"]) {
  if (mediaType === "carousel") return assets.length <= 10;
  if (mediaType === "image") return assets.length <= 1 && assets.every((asset) => asset.kind === "image");
  if (["bit", "clip", "vod"].includes(mediaType)) {
    return assets.length <= 1 && assets.every((asset) => asset.kind === "video");
  }
  return false;
}

class UploadPausedError extends Error {}

async function uploadVideo(
  file: File,
  session: UploadSession,
  contentId: string,
  onProgress: (progress: number) => void,
  activeUpload: { current: tus.Upload | null },
  pauseCurrentUpload: { current: (() => void) | null }
) {
  await new Promise<void>((resolve, reject) => {
    const upload = new tus.Upload(file, {
      endpoint: session.uploadUrl,
      headers: session.headers ?? {},
      metadata: { contentId, filename: file.name, filetype: file.type },
      onError: reject,
      onProgress(bytesSent, bytesTotal) {
        onProgress(bytesTotal > 0 ? Math.round((bytesSent / bytesTotal) * 100) : 0);
      },
      onSuccess: () => resolve(),
      removeFingerprintOnSuccess: true,
      retryDelays: [0, 3_000, 5_000, 10_000],
      storeFingerprintForResuming: true,
      uploadSize: file.size
    });
    activeUpload.current = upload;
    pauseCurrentUpload.current = () => reject(new UploadPausedError());
    void upload.findPreviousUploads().then((previousUploads) => {
      if (previousUploads[0]) upload.resumeFromPreviousUpload(previousUploads[0]);
      upload.start();
    }).catch(reject);
  }).finally(() => {
    activeUpload.current = null;
    pauseCurrentUpload.current = null;
  });
}

function messageFor(caught: unknown) {
  if (caught instanceof ApiMutationError) return caught.message;
  return caught instanceof Error ? caught.message : "The photo draft could not be updated.";
}
