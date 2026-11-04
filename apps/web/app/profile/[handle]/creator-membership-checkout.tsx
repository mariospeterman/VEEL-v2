"use client";

import dynamic from "next/dynamic";
import type { SubscriptionPlan } from "@/api-client";

const CreatorMembershipRuntime = dynamic(
  () => import("./creator-membership-runtime").then((module) => module.CreatorMembershipRuntime),
  {
    loading: () => <p className="mt-4 text-sm text-(--muted)">Loading secure wallet options…</p>,
    ssr: false
  }
);

export function CreatorMembershipCheckout({ plan }: { plan: SubscriptionPlan }) {
  return <CreatorMembershipRuntime plan={plan} />;
}
