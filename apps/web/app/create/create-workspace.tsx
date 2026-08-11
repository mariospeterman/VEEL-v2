"use client";

import { Fact, NumberInput, Select, UploadSessionPanel } from "./create-workspace-fields";
import {
  mediaTypes,
  nsfwLabels,
  useCreateWorkspaceState,
  visibilityValues
} from "./create-workspace-state";

export function CreateWorkspace() {
  const { actions, state } = useCreateWorkspaceState();

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

        <button
          className="rounded bg-(--foreground) px-3 py-2 text-sm font-semibold text-(--background) disabled:cursor-not-allowed disabled:opacity-50"
          disabled={state.pending !== null}
          type="submit"
        >
          {state.pending === "draft" ? "Creating draft" : "Create server draft"}
        </button>
      </form>

      {state.draft ? (
        <DraftPanel actions={actions} state={state} />
      ) : null}

      {state.uploadSession ? (
        <UploadSessionPanel
          onAbortUpload={actions.onAbortUpload}
          onStartUpload={actions.onStartUpload}
          uploadProgress={state.uploadProgress}
          uploadSession={state.uploadSession}
          uploadState={state.uploadState}
          uploadedUrl={state.uploadedUrl}
          onSyncProviderStatus={actions.onSyncProviderStatus}
          syncDisabled={!state.draft || state.pending !== null || state.uploadState !== "complete"}
          syncLabel={state.pending === "sync" ? "Syncing provider" : "Sync provider status"}
        />
      ) : null}
      {state.error ? <p className="mt-3 text-sm font-medium text-red-400">{state.error}</p> : null}
    </section>
  );
}

function DraftPanel({
  actions,
  state
}: {
  actions: ReturnType<typeof useCreateWorkspaceState>["actions"];
  state: ReturnType<typeof useCreateWorkspaceState>["state"];
}) {
  const draft = state.draft;
  if (!draft) return null;

  return (
    <div className="mt-4 grid gap-3 rounded border border-(--line) bg-(--background) p-3 text-sm">
      <Fact label="Draft" value={draft.id} />
      <Fact label="Access" value={draft.accessState} />
      <Fact label="Playback" value={draft.playback?.state ?? "not_ready"} />
      <Fact label="Provider" value={draft.playback?.provider ?? state.uploadSession?.provider ?? "not_synced"} />
      <Fact label="Visibility" value={state.visibility} />
      <Fact label="Label" value={state.nsfwLabel} />
      <Fact label="Publish" value={state.publishState} />
      {state.providerSyncedAt ? <Fact label="Provider synced" value={state.providerSyncedAt} /> : null}
      {state.savedAt ? <Fact label="Last saved" value={state.savedAt} /> : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <NumberInput label="Teaser start ms" onChange={actions.setTeaserStartMs} value={state.teaserStartMs} />
        <NumberInput label="Teaser end ms" onChange={actions.setTeaserEndMs} value={state.teaserEndMs} />
        <NumberInput label="Thumbnail frame ms" onChange={actions.setThumbnailFrameMs} value={state.thumbnailFrameMs} />
      </div>
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
        <span className="text-(--muted)">Video file</span>
        <input accept="video/mp4,video/quicktime,video/webm" onChange={actions.onFileChange} type="file" />
      </label>
      <button
        className="rounded border border-(--line) px-3 py-2 font-semibold disabled:cursor-not-allowed disabled:opacity-50"
        disabled={!state.file || state.pending !== null}
        onClick={actions.onCreateUploadSession}
        type="button"
      >
        {state.pending === "upload" ? "Creating upload session" : "Create Bunny upload session"}
      </button>
    </div>
  );
}
