"use client";

import {
  Ban,
  Bookmark,
  EyeOff,
  Flag,
  Heart,
  MessageCircle,
  Share2,
  X
} from "lucide-react";
import { useRef, useState } from "react";
import { safeMutationMessage } from "@/api-errors";
import {
  blockUser,
  createContentComment,
  createContentShare,
  createSafetyReport,
  getContentComments,
  hideFeedCreator,
  toggleContentLike,
  toggleContentSave,
  type Comment,
  type EngagementState
} from "@/api-mutations";
import { createMutationIdempotencyKey } from "@/api-mutation-transport";

interface ContentEngagementPanelProps {
  contentId: string;
  creatorUserId: string;
  initialEngagement: EngagementState;
}

type Panel = "comments" | "report" | "safety" | null;
type PendingAction = "like" | "save" | "share" | "comment" | "report" | "hide" | "block" | null;

export function ContentEngagementPanel({
  contentId,
  creatorUserId,
  initialEngagement
}: ContentEngagementPanelProps) {
  const [engagement, setEngagement] = useState(initialEngagement);
  const [panel, setPanel] = useState<Panel>(null);
  const [pending, setPending] = useState<PendingAction>(null);
  const [notice, setNotice] = useState<{ kind: "error" | "success"; text: string; href?: string } | null>(null);
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [commentBody, setCommentBody] = useState("");
  const [reportReason, setReportReason] = useState("");
  const [hidden, setHidden] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const actionAttempts = useRef<Record<string, string>>({});
  const commentAttempt = useRef<{ input: string; key: string } | null>(null);
  const reportAttempt = useRef<{ input: string; key: string } | null>(null);

  async function toggleAction(action: "like" | "save") {
    setPending(action);
    setNotice(null);
    const key = actionAttempts.current[action] ?? createMutationIdempotencyKey();
    actionAttempts.current[action] = key;

    try {
      const next = action === "like"
        ? await toggleContentLike(contentId, key)
        : await toggleContentSave(contentId, key);
      delete actionAttempts.current[action];
      setEngagement(next);
    } catch (error) {
      setNotice({ kind: "error", text: safeMutationMessage(error, `${action === "like" ? "Like" : "Save"} action`) });
    } finally {
      setPending(null);
    }
  }

  async function openComments() {
    setPanel(panel === "comments" ? null : "comments");
    setNotice(null);
    if (comments !== null || panel === "comments") return;

    setPending("comment");
    try {
      const page = await getContentComments(contentId);
      setComments(page.items);
    } catch (error) {
      setNotice({ kind: "error", text: safeMutationMessage(error, "Comments") });
    } finally {
      setPending(null);
    }
  }

  async function submitComment() {
    const input = commentBody.trim();
    if (!input) return;
    setPending("comment");
    setNotice(null);
    const key = retryKey(commentAttempt, input);

    try {
      const comment = await createContentComment(contentId, { body: input }, key);
      commentAttempt.current = null;
      setComments((current) => [comment, ...(current ?? [])]);
      setCommentBody("");
      setEngagement((current) => ({ ...current, commentCount: current.commentCount + 1 }));
      setNotice({ kind: "success", text: "Comment posted." });
    } catch (error) {
      setNotice({ kind: "error", text: safeMutationMessage(error, "Comment") });
    } finally {
      setPending(null);
    }
  }

  async function shareContent() {
    setPending("share");
    setNotice(null);
    const key = actionAttempts.current.share ?? createMutationIdempotencyKey();
    actionAttempts.current.share = key;

    try {
      const result = await createContentShare(
        { targetType: "content", targetId: contentId, mode: "copy_link" },
        key
      );
      delete actionAttempts.current.share;
      setEngagement((current) => ({ ...current, shareCount: current.shareCount + 1 }));
      if (result.url) {
        try {
          await navigator.clipboard.writeText(result.url);
          setNotice({ kind: "success", text: "Link copied." });
        } catch {
          setNotice({ kind: "success", text: "Share link ready.", href: result.url });
        }
      }
    } catch (error) {
      setNotice({ kind: "error", text: safeMutationMessage(error, "Share") });
    } finally {
      setPending(null);
    }
  }

  async function submitReport() {
    const input = reportReason.trim();
    if (input.length < 3) return;
    setPending("report");
    setNotice(null);
    const key = retryKey(reportAttempt, input);

    try {
      await createSafetyReport(
        { subjectType: "content", subjectId: contentId, reason: input },
        key
      );
      reportAttempt.current = null;
      setReportReason("");
      setPanel(null);
      setNotice({ kind: "success", text: "Report submitted for review." });
    } catch (error) {
      setNotice({ kind: "error", text: safeMutationMessage(error, "Report") });
    } finally {
      setPending(null);
    }
  }

  async function applySafetyAction(action: "hide" | "block") {
    setPending(action);
    setNotice(null);
    const key = actionAttempts.current[action] ?? createMutationIdempotencyKey();
    actionAttempts.current[action] = key;

    try {
      if (action === "hide") {
        await hideFeedCreator({ creatorUserId }, key);
        setHidden(true);
        setNotice({ kind: "success", text: "Creator hidden from your feed." });
      } else {
        await blockUser(creatorUserId, key);
        setBlocked(true);
        setNotice({ kind: "success", text: "Creator blocked." });
      }
      delete actionAttempts.current[action];
      setPanel(null);
    } catch (error) {
      setNotice({ kind: "error", text: safeMutationMessage(error, action === "hide" ? "Hide creator" : "Block creator") });
    } finally {
      setPending(null);
    }
  }

  const busy = pending !== null;

  return (
    <section className="rounded border border-(--line) bg-(--panel) p-4">
      <div className="grid grid-cols-3 gap-3 text-center">
        <Metric label="Likes" value={engagement.likeCount} />
        <Metric label="Comments" value={engagement.commentCount} />
        <Metric label="Shares" value={engagement.shareCount} />
      </div>

      <div className="mt-4 grid grid-cols-4 gap-2 border-t border-(--line) pt-4">
        <ActionButton
          active={engagement.liked}
          disabled={busy}
          icon={Heart}
          label={engagement.liked ? "Liked" : "Like"}
          onClick={() => toggleAction("like")}
        />
        <ActionButton
          active={engagement.saved}
          disabled={busy}
          icon={Bookmark}
          label={engagement.saved ? "Saved" : "Save"}
          onClick={() => toggleAction("save")}
        />
        <ActionButton disabled={busy} icon={Share2} label="Share" onClick={shareContent} />
        <ActionButton
          active={panel === "comments"}
          disabled={busy && pending !== "comment"}
          icon={MessageCircle}
          label="Comment"
          onClick={openComments}
        />
      </div>

      {panel === "comments" ? (
        <div className="mt-4 grid gap-3 border-t border-(--line) pt-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold">Comments</p>
            <IconButton label="Close comments" onClick={() => setPanel(null)} />
          </div>
          <textarea
            aria-label="Comment"
            className="min-h-24 w-full resize-y rounded border border-(--line) bg-(--background) p-3 text-sm outline-none focus:border-(--accent)"
            maxLength={2000}
            onChange={(event) => setCommentBody(event.target.value)}
            placeholder="Add a comment"
            value={commentBody}
          />
          <button
            className="rounded bg-(--foreground) px-3 py-2 text-sm font-semibold text-(--background) disabled:opacity-50"
            disabled={busy || !commentBody.trim()}
            onClick={submitComment}
            type="button"
          >
            {pending === "comment" ? "Posting" : "Post comment"}
          </button>
          <div className="grid max-h-64 gap-3 overflow-y-auto" aria-live="polite">
            {comments === null ? (
              <p className="text-sm text-(--muted)">Loading comments...</p>
            ) : comments.length === 0 ? (
              <p className="text-sm text-(--muted)">No comments yet.</p>
            ) : comments.map((comment) => (
              <article className="border-t border-(--line) pt-3 text-sm" key={comment.id}>
                <p className="font-semibold">@{comment.author.handle}</p>
                <p className="mt-1 break-words text-(--muted)">{comment.body}</p>
              </article>
            ))}
          </div>
        </div>
      ) : null}

      {panel === "report" ? (
        <div className="mt-4 grid gap-3 border-t border-(--line) pt-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold">Report content</p>
            <IconButton label="Close report" onClick={() => setPanel(null)} />
          </div>
          <textarea
            aria-label="Report reason"
            className="min-h-24 w-full resize-y rounded border border-(--line) bg-(--background) p-3 text-sm outline-none focus:border-(--accent)"
            maxLength={500}
            onChange={(event) => setReportReason(event.target.value)}
            placeholder="What should our safety team review?"
            value={reportReason}
          />
          <button
            className="rounded bg-[#b91c1c] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
            disabled={busy || reportReason.trim().length < 3}
            onClick={submitReport}
            type="button"
          >
            {pending === "report" ? "Submitting" : "Submit report"}
          </button>
        </div>
      ) : null}

      {panel === "safety" ? (
        <div className="mt-4 grid gap-2 border-t border-(--line) pt-4">
          <p className="text-sm font-semibold">Creator controls</p>
          <button
            className="flex items-center justify-center gap-2 rounded border border-(--line) px-3 py-2 text-sm font-medium disabled:opacity-50"
            disabled={busy || hidden}
            onClick={() => applySafetyAction("hide")}
            type="button"
          >
            <EyeOff aria-hidden="true" size={16} />
            {hidden ? "Creator hidden" : "Hide from feed"}
          </button>
          <button
            className="flex items-center justify-center gap-2 rounded border border-[#7f1d1d] px-3 py-2 text-sm font-medium text-[#fecaca] disabled:opacity-50"
            disabled={busy || blocked}
            onClick={() => applySafetyAction("block")}
            type="button"
          >
            <Ban aria-hidden="true" size={16} />
            {blocked ? "Creator blocked" : "Block creator"}
          </button>
        </div>
      ) : null}

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          className="flex items-center justify-center gap-2 rounded border border-[#7f1d1d] px-3 py-2 text-sm font-medium text-[#fecaca]"
          onClick={() => setPanel(panel === "report" ? null : "report")}
          type="button"
        >
          <Flag aria-hidden="true" size={16} />
          Report
        </button>
        <button
          className="flex items-center justify-center gap-2 rounded border border-(--line) px-3 py-2 text-sm font-medium"
          onClick={() => setPanel(panel === "safety" ? null : "safety")}
          type="button"
        >
          <EyeOff aria-hidden="true" size={16} />
          Creator controls
        </button>
      </div>

      {notice ? (
        <p
          className={`mt-3 rounded border px-3 py-2 text-sm ${
            notice.kind === "error"
              ? "border-[#7f1d1d] bg-[#450a0a] text-[#fecaca]"
              : "border-(--line) bg-(--background) text-(--muted)"
          }`}
          role="status"
        >
          {notice.text}{notice.href ? <> <a className="font-semibold underline" href={notice.href}>Open</a></> : null}
        </p>
      ) : null}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0">
      <p className="text-lg font-semibold">{value.toLocaleString()}</p>
      <p className="truncate text-xs text-(--muted)">{label}</p>
    </div>
  );
}

function ActionButton({
  active = false,
  disabled,
  icon: Icon,
  label,
  onClick
}: {
  active?: boolean;
  disabled: boolean;
  icon: typeof Heart;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-pressed={active}
      className={`grid min-h-14 min-w-0 place-items-center gap-1 rounded border px-1 py-2 text-xs font-medium transition disabled:opacity-50 ${
        active ? "border-(--accent) bg-(--accent-soft) text-(--accent-strong)" : "border-(--line) hover:bg-(--background)"
      }`}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      <Icon aria-hidden="true" fill={active ? "currentColor" : "none"} size={17} />
      <span className="max-w-full truncate">{label}</span>
    </button>
  );
}

function IconButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button aria-label={label} className="grid size-8 place-items-center rounded hover:bg-(--background)" onClick={onClick} type="button">
      <X aria-hidden="true" size={17} />
    </button>
  );
}

function retryKey(
  attempt: { current: { input: string; key: string } | null },
  input: string
) {
  if (attempt.current?.input === input) return attempt.current.key;
  const key = createMutationIdempotencyKey();
  attempt.current = { input, key };
  return key;
}
