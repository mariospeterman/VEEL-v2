"use client";

import { Select, UploadSessionPanel } from "./create-workspace-fields";
import {
  mediaTypes,
  nsfwLabels,
  useCreateWorkspaceState,
  visibilityValues
} from "./create-workspace-state";
import type { VerificationStatus } from "@/api-client";
import { AdultPublisherGate } from "../app/create/adult-publisher-gate";

export function CreateWorkspace({ verification }: { verification: VerificationStatus | null }) {
  const { actions, state } = useCreateWorkspaceState();
  const isAdultRated = state.nsfwLabel === "adult" || state.nsfwLabel === "explicit";
  const adultPublishingReady = verification?.capabilities.canPublishAdultMedia === true;

  return (
    <section className="rounded border border-(--line) bg-(--panel) p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-medium text-(--accent)">Post details</p>
          <h2 className="mt-1 text-lg font-semibold tracking-normal">Choose media and audience</h2>
        </div>
        <span className="rounded bg-(--background) px-2 py-1 text-xs text-(--muted)">
          Draft
        </span>
      </div>

      <form className="mt-4 grid gap-3" onSubmit={actions.onCreateDraft}>
        <label className="grid gap-1 text-sm">
          <span className="text-(--muted)">Caption</span>
          <textarea
            className="min-h-24 rounded border border-(--line) bg-(--background) px-3 py-2 text-(--foreground)"
            onChange={(event) => actions.setCaption(event.currentTarget.value)}
            value={state.caption}
          />
        </label>

        <div className="grid gap-3 sm:grid-cols-3">
          <Select label="Media" onChange={actions.setMediaType} options={mediaTypes} value={state.mediaType} />
          <Select label="Visibility" onChange={actions.setVisibility} options={visibilityValues} value={state.visibility} />
          <Select label="Content rating" onChange={actions.setNsfwLabel} options={nsfwLabels} value={state.nsfwLabel} />
        </div>

        {isAdultRated && !adultPublishingReady ? <AdultPublisherGate verification={verification} /> : null}

        <button
          className="rounded bg-(--foreground) px-3 py-2 text-sm font-semibold text-(--background) disabled:cursor-not-allowed disabled:opacity-50"
          disabled={state.pending !== null}
          type="submit"
        >
          {state.pending === "draft" ? "Creating draft" : "Continue"}
        </button>
      </form>

      {state.draft ? (
        <DraftPanel actions={actions} adultPublishingReady={!isAdultRated || adultPublishingReady} state={state} />
      ) : null}

      {state.uploadSession ? (
        <UploadSessionPanel
          onAbortUpload={actions.onAbortUpload}
          onStartUpload={actions.onStartUpload}
          uploadProgress={state.uploadProgress}
          uploadState={state.uploadState}
          onSyncProviderStatus={actions.onSyncProviderStatus}
          syncDisabled={!state.draft || state.pending !== null || state.uploadState !== "complete"}
          syncLabel={state.pending === "sync" ? "Preparing preview" : "Prepare preview"}
        />
      ) : null}
      {state.error ? <p className="mt-3 text-sm font-medium text-red-400">{state.error}</p> : null}
    </section>
  );
}

function DraftPanel({
  actions,
  adultPublishingReady,
  state
}: {
  actions: ReturnType<typeof useCreateWorkspaceState>["actions"];
  adultPublishingReady: boolean;
  state: ReturnType<typeof useCreateWorkspaceState>["state"];
}) {
  const draft = state.draft;
  if (!draft) return null;

  return (
    <div className="mt-4 grid gap-3 border-t border-(--line) pt-4 text-sm">
      <p className="text-(--muted)">{state.savedAt ? "Draft saved" : "Draft ready"}</p>
      <button
        className="rounded border border-(--line) px-3 py-2 font-semibold disabled:cursor-not-allowed disabled:opacity-50"
        disabled={state.pending !== null}
        onClick={actions.onSaveDraftSettings}
        type="button"
      >
        {state.pending === "save" ? "Saving settings" : "Save draft settings"}
      </button>
      <button
        className="rounded bg-(--foreground) px-3 py-2 font-semibold text-(--background) disabled:cursor-not-allowed disabled:opacity-50"
        disabled={
          !adultPublishingReady ||
          state.pending !== null ||
          state.uploadState !== "complete" ||
          draft.playback?.state !== "full" ||
          state.publishState === "submitted_for_review"
        }
        onClick={actions.onPublishDraft}
        type="button"
      >
        {state.pending === "publish" ? "Submitting for review" : "Submit for review"}
      </button>
      <label className="grid gap-1">
        <span className="text-(--muted)">Video</span>
        <input accept="video/mp4,video/quicktime,video/webm" onChange={actions.onFileChange} type="file" />
      </label>
      <button
        className="rounded border border-(--line) px-3 py-2 font-semibold disabled:cursor-not-allowed disabled:opacity-50"
        disabled={!adultPublishingReady || !state.file || state.pending !== null}
        onClick={actions.onCreateUploadSession}
        type="button"
      >
        {state.pending === "upload" ? "Preparing upload" : "Prepare upload"}
      </button>
    </div>
  );
}
