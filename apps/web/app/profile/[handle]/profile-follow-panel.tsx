"use client";

import { useState } from "react";
import type { FollowState } from "@/api-client";
import { FollowButton } from "../../follow-button";

export function ProfileFollowPanel({ initialState }: { initialState: FollowState }) {
  const [state, setState] = useState(initialState);
  return (
    <div className="grid gap-3 rounded border border-(--line) bg-(--panel) p-3">
      <div className="grid grid-cols-2 gap-3 text-sm">
        <ProfileCount label="Followers" value={state.followerCount} />
        <ProfileCount label="Following" value={state.followingCount} />
      </div>
      <FollowButton initialState={initialState} onChange={setState} userId={initialState.userId} />
    </div>
  );
}

function ProfileCount({ label, value }: { label: string; value: number }) {
  return <div><p className="font-semibold">{value.toLocaleString()}</p><p className="text-xs text-(--muted)">{label}</p></div>;
}
