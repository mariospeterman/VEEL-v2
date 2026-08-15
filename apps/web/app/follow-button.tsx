"use client";

import { useEffect, useRef, useState } from "react";
import { safeMutationMessage } from "@/api-errors";
import { followUser, unfollowUser, type FollowState } from "@/api-mutations";
import { createMutationIdempotencyKey } from "@/api-mutation-transport";

export function FollowButton({
  initialState,
  onChange,
  userId
}: {
  initialState: FollowState;
  onChange?: (state: FollowState) => void;
  userId: string;
}) {
  const [state, setState] = useState(initialState);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const retry = useRef<{ following: boolean; key: string } | null>(null);

  useEffect(() => {
    if (!pending) setState(initialState);
  }, [
    initialState.followerCount,
    initialState.following,
    initialState.followingCount,
    initialState.userId,
    pending
  ]);

  async function toggle() {
    const following = !state.following;
    const attempt = retry.current?.following === following
      ? retry.current
      : { following, key: createMutationIdempotencyKey() };
    retry.current = attempt;
    setPending(true);
    setError(null);

    try {
      const next = following
        ? await followUser(userId, attempt.key)
        : await unfollowUser(userId, attempt.key);
      retry.current = null;
      setState(next);
      onChange?.(next);
    } catch (failure) {
      setError(safeMutationMessage(failure, following ? "Follow" : "Unfollow"));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="follow-control">
      <button
        aria-pressed={state.following}
        className={state.following ? "secondary-button" : "primary-button"}
        disabled={pending}
        onClick={toggle}
        type="button"
      >
        {pending ? "Saving" : state.following ? "Following" : "Follow"}
      </button>
      {error ? <p className="follow-error" role="status">{error}</p> : null}
    </div>
  );
}
