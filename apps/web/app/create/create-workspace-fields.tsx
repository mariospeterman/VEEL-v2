import type { UploadState } from "./create-workspace-state";

export function UploadSessionPanel({
  onAbortUpload,
  onStartUpload,
  onSyncProviderStatus,
  syncDisabled,
  syncLabel,
  uploadProgress,
  uploadState
}: {
  onAbortUpload: () => Promise<void>;
  onStartUpload: () => Promise<void>;
  onSyncProviderStatus: () => Promise<void>;
  syncDisabled: boolean;
  syncLabel: string;
  uploadProgress: number;
  uploadState: UploadState;
}) {
  return (
    <div className="mt-4 grid gap-3 border-t border-(--line) pt-4 text-sm">
      <p className="font-medium">Upload media</p>
      <div className="grid gap-2">
        <div className="h-2 overflow-hidden rounded bg-(--line)">
          <div className="h-full bg-(--accent)" style={{ width: `${uploadProgress}%` }} />
        </div>
        <p className="text-sm text-(--muted)">{uploadState === "complete" ? "Upload complete" : `${uploadProgress}% uploaded`}</p>
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
