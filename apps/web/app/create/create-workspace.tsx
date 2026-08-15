"use client";

import { Select } from "./create-workspace-fields";
import {
  representationModes,
  useCreateWorkspaceState,
  visibilityValues
} from "./create-workspace-state";
import type { VerificationStatus } from "@/api-client";

export function CreateWorkspace({
  storageScope,
  verification
}: {
  storageScope: string | null;
  verification: VerificationStatus | null;
}) {
  const { actions, state } = useCreateWorkspaceState(storageScope);
  const ageReady = verification?.capabilities.canUploadMedia === true;
  const previewReady = state.draft?.playback?.state === "full";
  const uploading = state.uploadState === "uploading";

  return (
    <section className="overflow-hidden rounded border border-(--line) bg-(--panel)">
      <form className="grid gap-5 p-4 sm:p-5" onSubmit={actions.onCreateAndUpload}>
        <div>
          <p className="text-sm font-medium text-(--accent)">Media</p>
          <h2 className="mt-1 text-lg font-semibold tracking-normal">Choose your video</h2>
          <p className="mt-1 text-sm leading-6 text-(--muted)">You see it first. Your post stays private until review is complete.</p>
        </div>

        <label className="group grid min-h-56 cursor-pointer place-items-center overflow-hidden rounded border border-dashed border-(--line) bg-(--background) text-center focus-within:ring-2 focus-within:ring-(--accent)">
          {state.previewUrl ? (
            <video className="max-h-[56vh] w-full bg-black object-contain" controls muted playsInline src={state.previewUrl} />
          ) : (
            <span className="grid gap-2 p-8">
              <span className="font-semibold">Choose a video</span>
              <span className="text-sm text-(--muted)">MP4, MOV, or WebM</span>
            </span>
          )}
          <input
            accept="video/mp4,video/quicktime,video/webm"
            className="sr-only"
            onChange={actions.onFileChange}
            type="file"
          />
        </label>

        {state.file ? (
          <div className="grid gap-4 border-t border-(--line) pt-5">
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Caption</span>
              <textarea
                className="min-h-24 rounded border border-(--line) bg-(--background) px-3 py-2 text-(--foreground)"
                maxLength={2200}
                onChange={(event) => actions.setCaption(event.currentTarget.value)}
                placeholder="What do you want people to know?"
                value={state.caption}
              />
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <Select
                label="Who can see it after approval?"
                onChange={actions.setVisibility}
                optionLabel={visibilityLabel}
                options={visibilityValues}
                value={state.visibility}
              />
              <Select
                label="Who appears in this video?"
                onChange={actions.setRepresentationMode}
                optionLabel={representationLabel}
                options={representationModes}
                value={state.representationMode}
              />
            </div>

            {state.representationMode === "declared_performers" ? (
              <p className="rounded bg-(--accent-soft) p-3 text-sm leading-6 text-(--accent-strong)">
                You confirm everyone shown agreed to being recorded and shared. We may ask for names or additional consent before publication.
              </p>
            ) : null}

            <label className="flex min-h-12 items-start gap-3 rounded border border-(--line) bg-(--background) p-3 text-sm leading-5">
              <input
                checked={state.contentSafetyPolicyAccepted}
                className="mt-0.5"
                onChange={(event) => actions.setContentSafetyPolicyAccepted(event.currentTarget.checked)}
                type="checkbox"
              />
              <span>I have the right to upload and share this video, and it is safe-for-work.</span>
            </label>

            <button
              className="min-h-12 rounded bg-(--foreground) px-4 py-3 font-semibold text-(--background) disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!ageReady || !state.contentSafetyPolicyAccepted || state.pending !== null || uploading || state.uploadState === "complete"}
              type="submit"
            >
              {state.pending === "upload" || uploading ? "Uploading…" : state.uploadState === "failed" || state.uploadState === "aborted" ? "Start again" : "Upload video"}
            </button>
          </div>
        ) : null}
      </form>

      {state.uploadSession ? (
        <section aria-live="polite" className="grid gap-3 border-t border-(--line) p-4 sm:p-5">
          <div className="flex items-center justify-between gap-4 text-sm">
            <span className="font-medium">{uploadStateCopy(state.uploadState, previewReady)}</span>
            <span className="text-(--muted)">{state.uploadProgress}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded bg-(--line)">
            <div className="h-full bg-(--accent) transition-[width]" style={{ width: `${state.uploadProgress}%` }} />
          </div>
          <div className="flex flex-wrap gap-2">
            {uploading ? (
              <button className="rounded border border-(--line) px-3 py-2 text-sm font-semibold" onClick={actions.onAbortUpload} type="button">Pause</button>
            ) : state.uploadState === "failed" || state.uploadState === "aborted" ? (
              <button className="rounded border border-(--line) px-3 py-2 text-sm font-semibold" onClick={actions.onResumeUpload} type="button">Resume upload</button>
            ) : null}
            {state.uploadState === "complete" && !previewReady ? (
              <button className="rounded border border-(--line) px-3 py-2 text-sm font-semibold disabled:opacity-50" disabled={state.pending !== null} onClick={actions.onRefreshPreview} type="button">
                {state.pending === "sync" ? "Checking…" : "Check preview"}
              </button>
            ) : null}
            {previewReady && state.publishState !== "submitted_for_review" ? (
              <button className="rounded bg-(--foreground) px-4 py-2 text-sm font-semibold text-(--background) disabled:opacity-50" disabled={state.pending !== null} onClick={actions.onPublishDraft} type="button">
                {state.pending === "publish" ? "Submitting…" : "Submit for review"}
              </button>
            ) : null}
          </div>
          {state.publishState === "submitted_for_review" ? (
            <div className="rounded bg-(--accent-soft) p-3 text-sm leading-6 text-(--accent-strong)">
              Submitted. It remains private while review completes. You can follow the decision from your profile.
            </div>
          ) : null}
        </section>
      ) : null}

      {state.error ? <p className="border-t border-(--line) p-4 text-sm font-medium text-red-400" role="alert">{state.error}</p> : null}
    </section>
  );
}

function visibilityLabel(value: string) {
  const labels: Record<string, string> = {
    public: "Everyone",
    followers: "Followers",
    subscribers: "Members",
    private: "Only me"
  };
  return labels[value] ?? value;
}

function representationLabel(value: string) {
  const labels: Record<string, string> = {
    self_only: "Only me",
    no_real_person: "No identifiable person",
    declared_performers: "Other people"
  };
  return labels[value] ?? value;
}

function uploadStateCopy(state: string, previewReady: boolean) {
  if (previewReady) return "Preview ready";
  if (state === "complete") return "Preparing your preview";
  if (state === "uploading") return "Uploading securely";
  if (state === "failed") return "Upload interrupted";
  if (state === "aborted") return "Upload paused";
  return "Ready to upload";
}
