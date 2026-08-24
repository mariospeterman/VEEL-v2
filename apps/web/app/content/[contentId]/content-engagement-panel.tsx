"use client";

import {
  Ban,
  Bookmark,
  EyeOff,
  Flag,
  Heart,
  MessageCircle,
  Share2,
  Sparkles,
  X
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { safeMutationMessage } from "@/api-errors";
import {
  blockUser,
  createContentComment,
  createContentShare,
  createMessage,
  createSafetyReport,
  getContentComments,
  getConversationsForMutation,
  hideFeedCreator,
  toggleCommentLike,
  toggleContentLike,
  toggleContentSave,
  type Comment,
  type Conversation,
  type EngagementState
} from "@/api-mutations";
import { createMutationIdempotencyKey } from "@/api-mutation-transport";

interface ContentEngagementPanelProps {
  contentId: string;
  creatorUserId: string;
  initialEngagement: EngagementState;
  accessState?: "free" | "teaser" | "locked" | "unlocked" | "subscribed" | "pass_required";
}

type Panel = "comments" | "share" | "report" | "safety" | null;
type PendingAction = "like" | "save" | "share" | "comment" | "comment-like" | "report" | "hide" | "block" | null;

export function ContentEngagementPanel({
  contentId,
  creatorUserId,
  initialEngagement,
  accessState = "free"
}: ContentEngagementPanelProps) {
  const [engagement, setEngagement] = useState(initialEngagement);
  const [panel, setPanel] = useState<Panel>(null);
  const [pending, setPending] = useState<PendingAction>(null);
  const [notice, setNotice] = useState<{ kind: "error" | "success"; text: string; href?: string } | null>(null);
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [commentBody, setCommentBody] = useState("");
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const [conversationId, setConversationId] = useState("");
  const [reportReason, setReportReason] = useState("");
  const [hidden, setHidden] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const actionAttempts = useRef<Record<string, string>>({});
  const commentAttempt = useRef<{ input: string; key: string } | null>(null);
  const reportAttempt = useRef<{ input: string; key: string } | null>(null);
  const orderedComments = useMemo(() => orderCommentThread(comments ?? []), [comments]);

  async function toggleAction(action: "like" | "save") {
    setPending(action);
    setNotice(null);
    const key = actionAttempts.current[action] ?? createMutationIdempotencyKey();
    actionAttempts.current[action] = key;
    const previous = engagement;
    setEngagement((current) => action === "like"
      ? { ...current, liked: !current.liked, likeCount: current.likeCount + (current.liked ? -1 : 1) }
      : { ...current, saved: !current.saved });

    try {
      const next = action === "like"
        ? await toggleContentLike(contentId, key)
        : await toggleContentSave(contentId, key);
      delete actionAttempts.current[action];
      setEngagement(next);
    } catch (error) {
      setEngagement(previous);
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
      setComments((await getContentComments(contentId)).items);
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
    const attemptInput = `${replyTo?.id ?? "root"}:${input}`;
    const key = retryKey(commentAttempt, attemptInput);
    try {
      const comment = await createContentComment(contentId, {
        body: input,
        ...(replyTo ? { parentCommentId: replyTo.id } : {})
      }, key);
      commentAttempt.current = null;
      setComments((current) => [comment, ...(current ?? [])]);
      setCommentBody("");
      setReplyTo(null);
      setEngagement((current) => ({ ...current, commentCount: current.commentCount + 1 }));
      setNotice({ kind: "success", text: replyTo ? "Reply posted." : "Comment posted." });
    } catch (error) {
      setNotice({ kind: "error", text: safeMutationMessage(error, replyTo ? "Reply" : "Comment") });
    } finally {
      setPending(null);
    }
  }

  async function likeComment(comment: Comment) {
    setPending("comment-like");
    setNotice(null);
    const actionKey = `comment-like:${comment.id}`;
    const key = actionAttempts.current[actionKey] ?? createMutationIdempotencyKey();
    actionAttempts.current[actionKey] = key;
    setComments((current) => current?.map((item) => item.id === comment.id
      ? { ...item, liked: !item.liked, likeCount: item.likeCount + (item.liked ? -1 : 1) }
      : item) ?? null);
    try {
      const state = await toggleCommentLike(comment.id, key);
      delete actionAttempts.current[actionKey];
      setComments((current) => current?.map((item) => item.id === comment.id
        ? { ...item, liked: state.liked, likeCount: state.likeCount }
        : item) ?? null);
    } catch (error) {
      setComments((current) => current?.map((item) => item.id === comment.id ? comment : item) ?? null);
      setNotice({ kind: "error", text: safeMutationMessage(error, "Comment like") });
    } finally {
      setPending(null);
    }
  }

  async function openShare() {
    setPanel(panel === "share" ? null : "share");
    setNotice(null);
    if (conversations !== null || panel === "share") return;
    try {
      const result = await getConversationsForMutation();
      setConversations(result.items.filter((conversation) => conversation.canSend));
    } catch {
      setConversations([]);
    }
  }

  async function shareContent(mode: "copy_link" | "external_referral_link") {
    setPending("share");
    setNotice(null);
    const actionKey = `share:${mode}`;
    const key = actionAttempts.current[actionKey] ?? createMutationIdempotencyKey();
    actionAttempts.current[actionKey] = key;
    try {
      const result = await createContentShare({ targetType: "content", targetId: contentId, mode }, key);
      delete actionAttempts.current[actionKey];
      setEngagement((current) => ({ ...current, shareCount: current.shareCount + 1 }));
      if (result.url && mode === "copy_link") {
        try {
          await navigator.clipboard.writeText(result.url);
          setNotice({ kind: "success", text: "Link copied." });
        } catch {
          setNotice({ kind: "success", text: "Share link ready.", href: result.url });
        }
      } else if (result.url) {
        window.open(result.url, "_blank", "noopener,noreferrer");
        setNotice({ kind: "success", text: "Share link opened." });
      }
    } catch (error) {
      setNotice({ kind: "error", text: safeMutationMessage(error, "Share") });
    } finally {
      setPending(null);
    }
  }

  async function shareToConversation() {
    if (!conversationId) return;
    setPending("share");
    setNotice(null);
    const key = actionAttempts.current["share:internal"] ?? createMutationIdempotencyKey();
    actionAttempts.current["share:internal"] = key;
    try {
      await createContentShare({ targetType: "content", targetId: contentId, mode: "internal_message" }, key);
      await createMessage(conversationId, { body: "Shared a post", sharedContentItemId: contentId }, key);
      delete actionAttempts.current["share:internal"];
      setEngagement((current) => ({ ...current, shareCount: current.shareCount + 1 }));
      setPanel(null);
      setNotice({ kind: "success", text: "Post sent in Messages." });
    } catch (error) {
      setNotice({ kind: "error", text: safeMutationMessage(error, "Message share") });
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
      await createSafetyReport({ subjectType: "content", subjectId: contentId, reason: input }, key);
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
  const needsUnlock = accessState === "locked" || accessState === "teaser" || accessState === "pass_required";

  return (
    <section className="rounded border border-(--line) bg-(--panel) p-4">
      <div className="grid grid-cols-3 gap-3 text-center">
        <Metric label="Likes" value={engagement.likeCount} />
        <Metric label="Comments" value={engagement.commentCount} />
        <Metric label="Shares" value={engagement.shareCount} />
      </div>

      <div className={`mt-4 grid gap-2 border-t border-(--line) pt-4 ${needsUnlock ? "grid-cols-5" : "grid-cols-4"}`} aria-label="Post actions">
        <ActionButton active={engagement.liked} disabled={busy} icon={Heart} label={engagement.liked ? "Liked" : "Like"} onClick={() => void toggleAction("like")} />
        <ActionButton active={panel === "comments"} disabled={busy && pending !== "comment"} icon={MessageCircle} label="Comment" onClick={() => void openComments()} />
        <ActionButton active={engagement.saved} disabled={busy} icon={Bookmark} label={engagement.saved ? "Saved" : "Save"} onClick={() => void toggleAction("save")} />
        <ActionButton active={panel === "share"} disabled={busy} icon={Share2} label="Share" onClick={() => void openShare()} />
        {needsUnlock ? (
          <a className="grid min-h-14 place-items-center gap-1 rounded border border-(--accent) px-1 py-2 text-xs font-semibold text-(--accent-strong)" href={`/content/${contentId}#unlock`}>
            <Sparkles aria-hidden="true" size={17} />
            {accessState === "pass_required" ? "Get access" : "Unlock"}
          </a>
        ) : null}
      </div>

      {panel === "comments" ? (
        <div className="mt-4 grid gap-3 border-t border-(--line) pt-4" aria-label="Comments">
          <PanelTitle label="Comments" onClose={() => { setPanel(null); setReplyTo(null); }} />
          {replyTo ? (
            <div className="flex items-center justify-between rounded bg-(--background) px-3 py-2 text-xs">
              <span>Replying to @{replyTo.author.handle}</span>
              <button className="underline" onClick={() => setReplyTo(null)} type="button">Cancel</button>
            </div>
          ) : null}
          <textarea aria-label={replyTo ? `Reply to ${replyTo.author.handle}` : "Comment"} className="min-h-24 w-full resize-y rounded border border-(--line) bg-(--background) p-3 text-sm outline-none focus:border-(--accent)" maxLength={2000} onChange={(event) => setCommentBody(event.target.value)} placeholder={replyTo ? "Write a reply" : "Add a comment — use @handle to mention someone"} value={commentBody} />
          <button className="rounded bg-(--foreground) px-3 py-2 text-sm font-semibold text-(--background) disabled:opacity-50" disabled={busy || !commentBody.trim()} onClick={() => void submitComment()} type="button">
            {pending === "comment" ? "Posting" : replyTo ? "Post reply" : "Post comment"}
          </button>
          <div className="grid max-h-80 gap-3 overflow-y-auto" aria-live="polite">
            {comments === null ? <p className="text-sm text-(--muted)">Loading comments…</p>
              : comments.length === 0 ? <p className="text-sm text-(--muted)">No comments yet.</p>
                : orderedComments.map((comment) => (
                  <article className={`border-t border-(--line) pt-3 text-sm ${comment.parentCommentId ? "ml-6" : ""}`} key={comment.id}>
                    <p className="font-semibold">@{comment.author.handle}</p>
                    <p className="mt-1 break-words text-(--muted)">{comment.body}</p>
                    <div className="mt-2 flex gap-3 text-xs">
                      <button aria-pressed={comment.liked} className="font-semibold" disabled={pending === "comment-like"} onClick={() => void likeComment(comment)} type="button">
                        {comment.liked ? "Liked" : "Like"}{comment.likeCount ? ` · ${comment.likeCount}` : ""}
                      </button>
                      {!comment.parentCommentId ? <button className="font-semibold" onClick={() => setReplyTo(comment)} type="button">Reply{comment.replyCount ? ` · ${comment.replyCount}` : ""}</button> : null}
                    </div>
                  </article>
                ))}
          </div>
        </div>
      ) : null}

      {panel === "share" ? (
        <div className="mt-4 grid gap-3 border-t border-(--line) pt-4" aria-label="Share post">
          <PanelTitle label="Share post" onClose={() => setPanel(null)} />
          <div className="grid grid-cols-2 gap-2">
            <button className="secondary-button" disabled={busy} onClick={() => void shareContent("copy_link")} type="button">Copy link</button>
            <button className="secondary-button" disabled={busy} onClick={() => void shareContent("external_referral_link")} type="button">Share outside WeVid</button>
          </div>
          {conversations && conversations.length > 0 ? (
            <div className="grid gap-2">
              <label className="text-sm font-semibold" htmlFor={`share-conversation-${contentId}`}>Send in Messages</label>
              <select className="min-h-11 rounded border border-(--line) bg-(--background) px-3" id={`share-conversation-${contentId}`} onChange={(event) => setConversationId(event.target.value)} value={conversationId}>
                <option value="">Choose a conversation</option>
                {conversations.map((conversation) => <option key={conversation.id} value={conversation.id}>{conversation.title}</option>)}
              </select>
              <button className="primary-button" disabled={busy || !conversationId} onClick={() => void shareToConversation()} type="button">Send post</button>
            </div>
          ) : <a className="text-sm font-semibold underline" href="/app/messages">Open Messages to start a conversation</a>}
        </div>
      ) : null}

      {panel === "report" ? (
        <div className="mt-4 grid gap-3 border-t border-(--line) pt-4">
          <PanelTitle label="Report content" onClose={() => setPanel(null)} />
          <textarea aria-label="Report reason" className="min-h-24 w-full resize-y rounded border border-(--line) bg-(--background) p-3 text-sm outline-none focus:border-(--accent)" maxLength={500} onChange={(event) => setReportReason(event.target.value)} placeholder="What should our safety team review?" value={reportReason} />
          <button className="rounded bg-[#b91c1c] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={busy || reportReason.trim().length < 3} onClick={() => void submitReport()} type="button">{pending === "report" ? "Submitting" : "Submit report"}</button>
        </div>
      ) : null}

      {panel === "safety" ? (
        <div className="mt-4 grid gap-2 border-t border-(--line) pt-4">
          <p className="text-sm font-semibold">Creator controls</p>
          <button className="flex items-center justify-center gap-2 rounded border border-(--line) px-3 py-2 text-sm font-medium disabled:opacity-50" disabled={busy || hidden} onClick={() => void applySafetyAction("hide")} type="button"><EyeOff aria-hidden="true" size={16} />{hidden ? "Creator hidden" : "Hide from feed"}</button>
          <button className="flex items-center justify-center gap-2 rounded border border-[#7f1d1d] px-3 py-2 text-sm font-medium text-[#fecaca] disabled:opacity-50" disabled={busy || blocked} onClick={() => void applySafetyAction("block")} type="button"><Ban aria-hidden="true" size={16} />{blocked ? "Creator blocked" : "Block creator"}</button>
        </div>
      ) : null}

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button className="flex items-center justify-center gap-2 rounded border border-[#7f1d1d] px-3 py-2 text-sm font-medium text-[#fecaca]" onClick={() => setPanel(panel === "report" ? null : "report")} type="button"><Flag aria-hidden="true" size={16} />Report</button>
        <button className="flex items-center justify-center gap-2 rounded border border-(--line) px-3 py-2 text-sm font-medium" onClick={() => setPanel(panel === "safety" ? null : "safety")} type="button"><EyeOff aria-hidden="true" size={16} />Creator controls</button>
      </div>

      {notice ? <p className={`mt-3 rounded border px-3 py-2 text-sm ${notice.kind === "error" ? "border-[#7f1d1d] bg-[#450a0a] text-[#fecaca]" : "border-(--line) bg-(--background) text-(--muted)"}`} role="status">{notice.text}{notice.href ? <> <a className="font-semibold underline" href={notice.href}>Open</a></> : null}</p> : null}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div className="min-w-0"><p className="text-lg font-semibold">{value.toLocaleString()}</p><p className="truncate text-xs text-(--muted)">{label}</p></div>;
}

function ActionButton({ active = false, disabled, icon: Icon, label, onClick }: { active?: boolean; disabled: boolean; icon: typeof Heart; label: string; onClick: () => void }) {
  return <button aria-pressed={active} className={`grid min-h-14 min-w-0 place-items-center gap-1 rounded border px-1 py-2 text-xs font-medium transition disabled:opacity-50 ${active ? "border-(--accent) bg-(--accent-soft) text-(--accent-strong)" : "border-(--line) hover:bg-(--background)"}`} disabled={disabled} onClick={onClick} type="button"><Icon aria-hidden="true" fill={active ? "currentColor" : "none"} size={17} /><span className="max-w-full truncate">{label}</span></button>;
}

function PanelTitle({ label, onClose }: { label: string; onClose: () => void }) {
  return <div className="flex items-center justify-between gap-3"><p className="text-sm font-semibold">{label}</p><button aria-label={`Close ${label.toLowerCase()}`} className="grid min-h-11 min-w-11 place-items-center rounded hover:bg-(--background)" onClick={onClose} type="button"><X aria-hidden="true" size={17} /></button></div>;
}

function orderCommentThread(comments: Comment[]) {
  const roots = comments.filter((comment) => !comment.parentCommentId);
  const replies = comments.filter((comment) => comment.parentCommentId);
  const rootIds = new Set(roots.map((comment) => comment.id));
  const threaded = roots.flatMap((root) => [root, ...replies.filter((reply) => reply.parentCommentId === root.id)]);
  return [...threaded, ...replies.filter((reply) => !rootIds.has(reply.parentCommentId ?? ""))];
}

function retryKey(ref: { current: { input: string; key: string } | null }, input: string) {
  if (ref.current?.input === input) return ref.current.key;
  const key = createMutationIdempotencyKey();
  ref.current = { input, key };
  return key;
}
