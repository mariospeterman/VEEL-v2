"use client";

import { Download, RefreshCw, RotateCcw, ShieldOff, Square, Trash2, UserMinus, Volume2 } from "lucide-react";
import { useRef, useState } from "react";
import { safeMutationMessage } from "@/api-errors";
import {
  cancelContentExport,
  contentExportDownloadUrl,
  createContentExportDownloadGrant,
  createDataRequest,
  getPrivacySettingsForMutation,
  retryContentExport,
  setUserMute,
  unblockUser,
  type ContentExport,
  type DataRequest,
  type PrivacySettings
} from "@/api-mutations";
import { createMutationIdempotencyKey } from "@/api-mutation-transport";

export function PrivacyControls({ initial }: { initial: PrivacySettings }) {
  const [privacy, setPrivacy] = useState(initial);
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const requestKeys = useRef<Partial<Record<"export" | "delete", string>>>({});
  const relationshipKeys = useRef<Record<string, string>>({});
  const exportActionKeys = useRef<Record<string, string>>({});
  const hasActiveRequest = (type: "export" | "delete") => privacy.dataRequests.some((request) =>
    request.type === type && isDataRequestActive(request));

  async function removeRelationship(kind: "block" | "mute", userId: string) {
    setPending(`${kind}:${userId}`);
    setNotice(null);
    const actionKey = `${kind}:${userId}`;
    const idempotencyKey = relationshipKeys.current[actionKey] ?? createMutationIdempotencyKey();
    relationshipKeys.current[actionKey] = idempotencyKey;
    try {
      if (kind === "block") await unblockUser(userId, idempotencyKey);
      else await setUserMute(userId, false, idempotencyKey);
      delete relationshipKeys.current[actionKey];
      setPrivacy((current) => ({
        ...current,
        blockedUsers: kind === "block" ? current.blockedUsers.filter((user) => user.id !== userId) : current.blockedUsers,
        mutedUsers: kind === "mute" ? current.mutedUsers.filter((user) => user.id !== userId) : current.mutedUsers
      }));
      setNotice(kind === "block" ? "Account unblocked." : "Account unmuted.");
    } catch (error) {
      setNotice(safeMutationMessage(error, kind === "block" ? "Unblock" : "Unmute"));
    } finally {
      setPending(null);
    }
  }

  async function requestData(type: "export" | "delete") {
    setPending(`request:${type}`);
    setNotice(null);
    const key = requestKeys.current[type] ?? createMutationIdempotencyKey();
    requestKeys.current[type] = key;
    try {
      const request = await createDataRequest({ type }, key);
      delete requestKeys.current[type];
      setPrivacy((current) => ({
        ...current,
        dataRequests: [request, ...current.dataRequests.filter((item) => item.id !== request.id)]
      }));
      setNotice(type === "export" ? "Export request received." : "Deletion request received. We’ll verify it before processing.");
    } catch (error) {
      setNotice(safeMutationMessage(error, type === "export" ? "Data export" : "Account deletion"));
    } finally {
      setPending(null);
    }
  }

  async function refreshPrivacy() {
    setPending("refresh");
    setNotice(null);
    try {
      setPrivacy(await getPrivacySettingsForMutation());
      setNotice("Privacy status refreshed.");
    } catch (error) {
      setNotice(safeMutationMessage(error, "Privacy status"));
    } finally {
      setPending(null);
    }
  }

  async function updateContentExport(action: "cancel" | "retry" | "download", contentExport: ContentExport) {
    const pendingKey = `export:${action}:${contentExport.id}`;
    setPending(pendingKey);
    setNotice(null);
    const idempotencyKey = exportActionKeys.current[pendingKey] ?? createMutationIdempotencyKey();
    exportActionKeys.current[pendingKey] = idempotencyKey;

    try {
      if (action === "download") {
        const grant = await createContentExportDownloadGrant(contentExport.id, idempotencyKey);
        delete exportActionKeys.current[pendingKey];
        setNotice("Your export download is starting.");
        window.location.assign(contentExportDownloadUrl(contentExport.id, grant.id));
        return;
      }

      const updated = action === "cancel"
        ? await cancelContentExport(contentExport.id, idempotencyKey)
        : await retryContentExport(contentExport.id, idempotencyKey);
      delete exportActionKeys.current[pendingKey];
      setPrivacy((current) => replaceContentExport(current, updated));
      setNotice(action === "cancel" ? "Export cancellation requested." : "Export retry queued.");
    } catch (error) {
      setNotice(safeMutationMessage(error, action === "download" ? "Export download" : `Export ${action}`));
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="grid gap-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <RelationshipList icon={ShieldOff} label="Blocked accounts" users={privacy.blockedUsers} actionLabel="Unblock" pending={pending} onRemove={(id) => void removeRelationship("block", id)} />
        <RelationshipList icon={Volume2} label="Muted accounts" users={privacy.mutedUsers} actionLabel="Unmute" pending={pending} onRemove={(id) => void removeRelationship("mute", id)} />
      </div>
      <div className="rounded-xl border border-(--line) p-4">
        <h3 className="font-semibold">Your data</h3>
        <p className="mt-1 text-sm text-(--muted)">Export and deletion are verified workflows. Some records may be retained where safety, tax, payment, or legal duties require it.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button className="secondary-button" disabled={pending !== null || hasActiveRequest("export")} onClick={() => void requestData("export")} type="button"><Download aria-hidden="true" size={16} />{hasActiveRequest("export") ? "Export requested" : "Request export"}</button>
          <button className="secondary-button" disabled={pending !== null || hasActiveRequest("delete")} onClick={() => void requestData("delete")} type="button"><Trash2 aria-hidden="true" size={16} />{hasActiveRequest("delete") ? "Deletion requested" : "Request account deletion"}</button>
          <button className="secondary-button" disabled={pending !== null} onClick={() => void refreshPrivacy()} type="button"><RefreshCw aria-hidden="true" size={16} />{pending === "refresh" ? "Refreshing" : "Refresh status"}</button>
        </div>
        {privacy.dataRequests.length > 0 ? (
          <ul className="mt-4 grid gap-2 text-sm">
            {privacy.dataRequests.map((request) => (
              <li className="rounded bg-(--background) px-3 py-3" key={request.id}>
                <div className="flex items-center justify-between gap-3">
                  <span>{request.type === "export" ? "Data export" : "Account deletion"}</span>
                  <span className="text-(--muted)">{requestStateLabel(request.state)}</span>
                </div>
                {request.contentExport ? (
                  <ContentExportDetails
                    contentExport={request.contentExport}
                    pending={pending}
                    onAction={(action) => void updateContentExport(action, request.contentExport!)}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <a className="secondary-button w-fit" href="/mutuals">View Mutuals connections</a>
      {notice ? <p aria-live="polite" className="text-sm text-(--muted)">{notice}</p> : null}
    </div>
  );
}

function RelationshipList({ actionLabel, icon: Icon, label, onRemove, pending, users }: { actionLabel: string; icon: typeof UserMinus; label: string; onRemove: (id: string) => void; pending: string | null; users: PrivacySettings["blockedUsers"] }) {
  return <section className="rounded-xl border border-(--line) p-4"><h3 className="flex items-center gap-2 font-semibold"><Icon aria-hidden="true" size={17} />{label}</h3>{users.length === 0 ? <p className="mt-3 text-sm text-(--muted)">None</p> : <ul className="mt-3 grid gap-2">{users.map((user) => <li className="flex items-center justify-between gap-3 text-sm" key={user.id}><span>@{user.handle || "account"}</span><button className="underline" disabled={pending !== null} onClick={() => onRemove(user.id)} type="button">{actionLabel}</button></li>)}</ul>}</section>;
}

function ContentExportDetails({
  contentExport,
  onAction,
  pending
}: {
  contentExport: ContentExport;
  onAction: (action: "cancel" | "retry" | "download") => void;
  pending: string | null;
}) {
  const progress = contentExport.progress;
  const progressPercent = progress.totalItems === 0
    ? contentExport.state === "ready" ? 100 : 0
    : Math.min(100, Math.round((progress.completedItems / progress.totalItems) * 100));
  const actionPending = pending?.endsWith(`:${contentExport.id}`) ?? false;

  return (
    <div className="mt-3 border-t border-(--line) pt-3">
      <div className="flex items-center justify-between gap-3 text-xs text-(--muted)">
        <span>{contentExportStateLabel(contentExport.state)}</span>
        <span>{progress.completedItems} / {progress.totalItems} items</span>
      </div>
      <div
        aria-label="Content export progress"
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={progressPercent}
        className="mt-2 h-2 overflow-hidden rounded-full bg-(--line)"
        role="progressbar"
      >
        <div className="h-full rounded-full bg-(--foreground)" style={{ width: `${progressPercent}%` }} />
      </div>
      {progress.unavailableItems > 0 ? (
        <p className="mt-2 text-xs text-(--muted)">
          {progress.unavailableItems} item{progress.unavailableItems === 1 ? "" : "s"} could not be included; the archive manifest records why.
        </p>
      ) : null}
      {contentExport.lastErrorCode ? (
        <p className="mt-2 text-xs text-(--muted)">Last attempt needs attention. You can retry when the control becomes available.</p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {contentExport.canCancel ? (
          <button className="secondary-button" disabled={pending !== null} onClick={() => onAction("cancel")} type="button">
            <Square aria-hidden="true" size={14} />{actionPending ? "Working" : "Cancel export"}
          </button>
        ) : null}
        {contentExport.canRetry ? (
          <button className="secondary-button" disabled={pending !== null} onClick={() => onAction("retry")} type="button">
            <RotateCcw aria-hidden="true" size={14} />{actionPending ? "Working" : "Retry export"}
          </button>
        ) : null}
        {contentExport.canDownload ? (
          <button className="secondary-button" disabled={pending !== null} onClick={() => onAction("download")} type="button">
            <Download aria-hidden="true" size={14} />{actionPending ? "Preparing" : "Download export"}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function replaceContentExport(privacy: PrivacySettings, contentExport: ContentExport): PrivacySettings {
  return {
    ...privacy,
    dataRequests: privacy.dataRequests.map((request) => request.id === contentExport.dataRequestId
      ? {
          ...request,
          contentExport,
          state: dataRequestStateForContentExport(contentExport.state)
        }
      : request)
  };
}

function dataRequestStateForContentExport(state: ContentExport["state"]): DataRequest["state"] {
  if (state === "ready" || state === "expired") return "completed";
  if (state === "cancelled") return "cancelled";
  if (state === "dead_letter") return "failed";
  return "processing";
}

function isDataRequestActive(request: DataRequest) {
  if (request.contentExport) {
    return request.contentExport.state === "queued"
      || request.contentExport.state === "processing"
      || request.contentExport.state === "retry";
  }
  return request.state === "requested" || request.state === "verifying" || request.state === "processing";
}

function contentExportStateLabel(state: ContentExport["state"]) {
  if (state === "queued") return "Queued";
  if (state === "processing") return "Building archive";
  if (state === "retry") return "Waiting to retry";
  if (state === "ready") return "Ready to download";
  if (state === "cancelled") return "Cancelled";
  if (state === "dead_letter") return "Retry required";
  return "Download window expired";
}

function requestStateLabel(state: PrivacySettings["dataRequests"][number]["state"]) {
  if (state === "requested") return "Received";
  if (state === "verifying") return "Verifying";
  if (state === "processing") return "In progress";
  if (state === "completed") return "Complete";
  if (state === "cancelled") return "Cancelled";
  if (state === "failed") return "Failed";
  if (state === "rejected") return "Rejected";
  return "Needs attention";
}
