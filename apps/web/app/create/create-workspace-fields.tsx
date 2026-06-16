import type { UploadSession } from "@/api-mutations";
import type { UploadState } from "./create-workspace-state";

export function UploadSessionPanel({
  onAbortUpload,
  onStartUpload,
  onSyncProviderStatus,
  syncDisabled,
  syncLabel,
  uploadProgress,
  uploadSession,
  uploadState,
  uploadedUrl
}: {
  onAbortUpload: () => Promise<void>;
  onStartUpload: () => Promise<void>;
  onSyncProviderStatus: () => Promise<void>;
  syncDisabled: boolean;
  syncLabel: string;
  uploadProgress: number;
  uploadSession: UploadSession;
  uploadState: UploadState;
  uploadedUrl: string | null;
}) {
  const headers = Object.entries(uploadSession.headers ?? {});

  return (
    <div className="mt-4 grid gap-3 rounded border border-(--line) bg-(--background) p-3 text-sm">
      <Fact label="Provider" value={uploadSession.provider} />
      <Fact label="Media asset" value={uploadSession.mediaAssetId} />
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
          <button
            className="rounded border border-(--line) px-3 py-2 font-semibold disabled:cursor-not-allowed disabled:opacity-50"
            disabled={syncDisabled}
            onClick={onSyncProviderStatus}
            type="button"
          >
            {syncLabel}
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

export function Select<T extends string>({
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

export function NumberInput({
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

export function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs uppercase text-(--muted)">{label}</p>
      <p className="mt-1 break-words font-medium">{value}</p>
    </div>
  );
}
