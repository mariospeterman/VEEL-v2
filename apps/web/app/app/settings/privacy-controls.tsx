"use client";

import { Download, ShieldOff, Trash2, UserMinus, Volume2 } from "lucide-react";
import { useRef, useState } from "react";
import { safeMutationMessage } from "@/api-errors";
import {
  createDataRequest,
  setUserMute,
  unblockUser,
  type PrivacySettings
} from "@/api-mutations";
import { createMutationIdempotencyKey } from "@/api-mutation-transport";

export function PrivacyControls({ initial }: { initial: PrivacySettings }) {
  const [privacy, setPrivacy] = useState(initial);
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const requestKeys = useRef<Partial<Record<"export" | "delete", string>>>({});
  const relationshipKeys = useRef<Record<string, string>>({});
  const hasActiveRequest = (type: "export" | "delete") => privacy.dataRequests.some((request) =>
    request.type === type && (request.state === "requested" || request.state === "verifying" || request.state === "processing"));

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
        </div>
        {privacy.dataRequests.length > 0 ? <ul className="mt-4 grid gap-2 text-sm">{privacy.dataRequests.map((request) => <li className="flex items-center justify-between gap-3 rounded bg-(--background) px-3 py-2" key={request.id}><span>{request.type === "export" ? "Data export" : "Account deletion"}</span><span className="text-(--muted)">{requestStateLabel(request.state)}</span></li>)}</ul> : null}
      </div>
      <a className="secondary-button w-fit" href="/mutuals">Manage Mutuals privacy</a>
      {notice ? <p aria-live="polite" className="text-sm text-(--muted)">{notice}</p> : null}
    </div>
  );
}

function RelationshipList({ actionLabel, icon: Icon, label, onRemove, pending, users }: { actionLabel: string; icon: typeof UserMinus; label: string; onRemove: (id: string) => void; pending: string | null; users: PrivacySettings["blockedUsers"] }) {
  return <section className="rounded-xl border border-(--line) p-4"><h3 className="flex items-center gap-2 font-semibold"><Icon aria-hidden="true" size={17} />{label}</h3>{users.length === 0 ? <p className="mt-3 text-sm text-(--muted)">None</p> : <ul className="mt-3 grid gap-2">{users.map((user) => <li className="flex items-center justify-between gap-3 text-sm" key={user.id}><span>@{user.handle || "account"}</span><button className="underline" disabled={pending !== null} onClick={() => onRemove(user.id)} type="button">{actionLabel}</button></li>)}</ul>}</section>;
}

function requestStateLabel(state: PrivacySettings["dataRequests"][number]["state"]) {
  if (state === "requested") return "Received";
  if (state === "verifying") return "Verifying";
  if (state === "processing") return "In progress";
  if (state === "completed") return "Complete";
  return "Needs attention";
}
