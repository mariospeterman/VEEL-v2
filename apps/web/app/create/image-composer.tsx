"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import type { VerificationStatus } from "@/api-client";
import { createMutationIdempotencyKey } from "@/api-mutation-transport";
import {
  ApiMutationError,
  createContentDraft,
  getContentForMutation,
  publishContent,
  retireContentMediaAsset,
  updateContent,
  updateContentMediaAsset,
  uploadContentImageAsset,
  type ContentItem,
  type CreateContentRequest
} from "@/api-mutations";
import { Select } from "./create-workspace-fields";
import { nsfwLabels, representationModes, visibilityValues } from "./create-workspace-state";

type Origin = "human_created" | "ai_assisted" | "ai_generated" | "materially_ai_manipulated";
type LocalAsset = {
  key: string;
  file: File;
  previewUrl: string;
  altText: string;
  originClassification: Origin;
  mediaAssetId?: string;
};

const acceptedImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const origins: Origin[] = ["human_created", "ai_assisted", "ai_generated", "materially_ai_manipulated"];

export function ImageComposer({
  onBack,
  storageScope,
  verification
}: {
  onBack: () => void;
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
  const uploadKeys = useRef(new Map<string, string>());
  const removalKeys = useRef(new Map<string, string>());
  const previewUrls = useRef(new Set<string>());
  const draftKey = storageScope ? `wevid:create:${storageScope}:image-draft-v1` : null;
  const allUploaded = assets.length > 0 && assets.every((asset) => asset.mediaAssetId);
  const ageReady = verification?.capabilities.canUploadMedia === true;

  useEffect(() => () => {
    for (const previewUrl of previewUrls.current) URL.revokeObjectURL(previewUrl);
    previewUrls.current.clear();
  }, []);

  useEffect(() => {
    if (!draftKey) return;
    const saved = window.localStorage.getItem(draftKey);
    if (!saved) return;
    try {
      const value = JSON.parse(saved) as { draftId?: string; caption?: string };
      if (typeof value.caption === "string") setCaption(value.caption);
      if (value.draftId) void getContentForMutation(value.draftId).then(setDraft).catch(() => undefined);
    } catch {
      window.localStorage.removeItem(draftKey);
    }
  }, [draftKey]);

  useEffect(() => {
    if (!draftKey) return;
    window.localStorage.setItem(draftKey, JSON.stringify({ draftId: draft?.id, caption }));
  }, [caption, draft?.id, draftKey]);

  const formatLabel = useMemo(() => assets.length > 1 ? "Photo carousel" : "Photo", [assets.length]);

  function onFiles(event: ChangeEvent<HTMLInputElement>) {
    const selected = [...(event.currentTarget.files ?? [])];
    const invalid = selected.find((file) => !acceptedImageTypes.has(file.type));
    if (invalid || selected.length === 0 || selected.length > 10) {
      setError("Choose 1–10 JPEG, PNG, or WebP images.");
      return;
    }
    for (const previewUrl of previewUrls.current) URL.revokeObjectURL(previewUrl);
    previewUrls.current.clear();
    setAssets(selected.map((file) => {
      const previewUrl = URL.createObjectURL(file);
      previewUrls.current.add(previewUrl);
      return {
        key: `${file.name}:${file.size}:${file.lastModified}`,
        file,
        previewUrl,
        altText: "",
        originClassification: "human_created"
      };
    }));
    setProgress(0);
    setAccepted(false);
    setSubmitted(false);
    setError(null);
    setNotice(null);
  }

  async function onUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (assets.length === 0) return setError("Choose at least one photo.");
    if (assets.some((asset) => !asset.altText.trim())) return setError("Add alt text for every photo.");
    if (!accepted) return setError("Confirm the rights and safety declaration.");
    setPending("upload");
    setError(null);
    try {
      let activeDraft = draft;
      if (!activeDraft) {
        activeDraft = await createContentDraft({
          mediaType: assets.length === 1 ? "image" : "carousel",
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
        if (localAsset.mediaAssetId) continue;
        let idempotencyKey = uploadKeys.current.get(localAsset.key);
        if (!idempotencyKey) {
          idempotencyKey = createMutationIdempotencyKey();
          uploadKeys.current.set(localAsset.key, idempotencyKey);
        }
        const uploaded = await uploadContentImageAsset(activeDraft.id, localAsset.file, idempotencyKey);
        let refreshed = await getContentForMutation(activeDraft.id);
        const updated = await updateContentMediaAsset(uploaded.mediaAssetId, {
          expectedCompositionRevision: refreshed.compositionRevision ?? 1,
          altText: localAsset.altText.trim(),
          originClassification: localAsset.originClassification
        });
        nextAssets[index] = { ...localAsset, mediaAssetId: uploaded.mediaAssetId };
        setAssets([...nextAssets]);
        setProgress(Math.round(((index + 1) / nextAssets.length) * 100));
        refreshed = { ...refreshed, compositionRevision: updated.compositionRevision };
        activeDraft = refreshed;
        setDraft(refreshed);
      }
      setDraft(await getContentForMutation(activeDraft.id));
    } catch (caught) {
      setError(messageFor(caught));
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
      setNotice("Photo details saved.");
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
        ? "Photo removed."
        : "Photo removed. Private provider cleanup is queued for retry.");
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setPending(null);
    }
  }

  async function onPublish() {
    if (!draft) return;
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
        <button className="justify-self-start text-sm font-semibold text-(--accent-text)" onClick={onBack} type="button">← Change media type</button>
        <div>
          <p className="text-sm font-medium text-(--accent-text)">{formatLabel}</p>
          <h2 className="mt-1 text-lg font-semibold">Choose your photos</h2>
          <p className="mt-1 text-sm leading-6 text-(--muted)">We remove embedded metadata before private storage. Nothing is public before review.</p>
        </div>
        <label className="grid min-h-32 cursor-pointer place-items-center rounded border border-dashed border-(--line) bg-(--background) p-6 text-center focus-within:ring-2 focus-within:ring-(--accent)">
          <span><span className="block font-semibold">Choose 1–10 photos</span><span className="mt-1 block text-sm text-(--muted)">JPEG, PNG, or WebP · 20 MB each</span></span>
          <input accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={assets.some((asset) => Boolean(asset.mediaAssetId))} multiple onChange={onFiles} type="file" />
        </label>

        {assets.length > 0 ? <ol aria-label="Photo order" className="grid gap-3 sm:grid-cols-2">
          {assets.map((asset, index) => <li className="grid gap-3 rounded border border-(--line) bg-(--background) p-3" key={asset.key}>
            <img alt="" className="aspect-square w-full rounded bg-black object-contain" src={asset.previewUrl} />
            <div className="flex items-center justify-between gap-2 text-sm"><span className="font-semibold">Photo {index + 1}</span><span className="text-(--muted)">{asset.mediaAssetId ? "Stored privately" : "Not uploaded"}</span></div>
            <label className="grid gap-1 text-sm"><span className="text-(--muted)">Alt text</span><textarea className="min-h-20 rounded border border-(--line) bg-(--panel) px-3 py-2" maxLength={1000} onChange={(event) => { const altText = event.currentTarget.value; setAssets((current) => current.map((item) => item.key === asset.key ? { ...item, altText } : item)); }} value={asset.altText} /></label>
            <Select label="How was this made?" onChange={(originClassification) => setAssets((current) => current.map((item) => item.key === asset.key ? { ...item, originClassification } : item))} optionLabel={originLabel} options={origins} value={asset.originClassification} />
            <div className="flex flex-wrap gap-2"><button aria-label={`Move photo ${index + 1} earlier`} className="rounded border border-(--line) px-3 py-2 text-sm disabled:opacity-40" disabled={index === 0 || pending !== null} onClick={() => void moveAsset(index, -1)} type="button">Earlier</button><button aria-label={`Move photo ${index + 1} later`} className="rounded border border-(--line) px-3 py-2 text-sm disabled:opacity-40" disabled={index === assets.length - 1 || pending !== null} onClick={() => void moveAsset(index, 1)} type="button">Later</button>{asset.mediaAssetId ? <button className="rounded border border-(--line) px-3 py-2 text-sm disabled:opacity-40" disabled={pending !== null || !asset.altText.trim()} onClick={() => void saveAssetDetails(asset)} type="button">Save details</button> : null}<button className="ml-auto rounded border border-(--line) px-3 py-2 text-sm disabled:opacity-40" disabled={pending !== null} onClick={() => void removeAsset(asset)} type="button">{pending === "remove" ? "Removing…" : "Remove"}</button></div>
          </li>)}
        </ol> : null}

        {assets.length > 0 ? <>
          <label className="grid gap-1 text-sm"><span className="font-medium">Caption</span><textarea className="min-h-24 rounded border border-(--line) bg-(--background) px-3 py-2" maxLength={2200} onChange={(event) => setCaption(event.currentTarget.value)} value={caption} /></label>
          <div className="grid gap-3 sm:grid-cols-2"><Select label="Content rating" onChange={(value) => { setNsfwLabel(value); setAccepted(false); }} options={nsfwLabels} value={nsfwLabel} /><Select label="Who can see it after approval?" onChange={setVisibility} options={visibilityValues} value={visibility} /><Select label="Who is represented?" onChange={(value) => { setRepresentationMode(value); setAccepted(false); }} options={representationModes} value={representationMode} /></div>
          <label className="flex min-h-12 items-start gap-3 rounded border border-(--line) bg-(--background) p-3 text-sm leading-5"><input checked={accepted} className="mt-0.5" onChange={(event) => setAccepted(event.currentTarget.checked)} type="checkbox" /><span>I have the right to share these photos, and every identifiable person is 18+ and consented.</span></label>
          <button className="min-h-12 rounded bg-(--foreground) px-4 py-3 font-semibold text-(--background) disabled:opacity-50" disabled={!ageReady || !accepted || pending !== null || allUploaded} type="submit">{pending === "upload" ? `Uploading ${progress}%…` : allUploaded ? "Photos stored privately" : "Upload photos"}</button>
        </> : null}
      </form>

      {allUploaded ? <section aria-live="polite" className="grid gap-3 border-t border-(--line) p-4 sm:p-5"><p className="text-sm leading-6 text-(--muted)">Upload complete. Publication stays blocked until the configured image provider and safety review return complete release evidence.</p><button className="justify-self-start rounded bg-(--foreground) px-4 py-2 text-sm font-semibold text-(--background) disabled:opacity-50" disabled={pending !== null || submitted} onClick={() => void onPublish()} type="button">{pending === "publish" ? "Checking readiness…" : submitted ? "Submitted for review" : "Review and submit"}</button></section> : null}
      {notice ? <p className="border-t border-(--line) p-4 text-sm font-medium text-(--muted)" role="status">{notice}</p> : null}
      {error ? <p className="border-t border-(--line) p-4 text-sm font-medium text-red-400" role="alert">{error}</p> : null}
    </section>
  );
}

function originLabel(value: Origin) {
  return ({ human_created: "Created by me", ai_assisted: "AI-assisted", ai_generated: "AI-generated", materially_ai_manipulated: "Materially AI-edited" } as const)[value];
}

function messageFor(caught: unknown) {
  if (caught instanceof ApiMutationError) return caught.message;
  return caught instanceof Error ? caught.message : "The photo draft could not be updated.";
}
