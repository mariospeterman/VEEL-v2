"use client";

import type { SubscriptionPlan } from "@/api-client";
import { WalletRuntimeProviders } from "@/wallet/wallet-runtime-providers";
import { SubscriptionAuthorizationPanel } from "../../subscriptions/subscription-authorization-panel";

export function CreatorMembershipRuntime({ plan }: { plan: SubscriptionPlan }) {
  return (
    <WalletRuntimeProviders>
      <SubscriptionAuthorizationPanel plan={plan} />
    </WalletRuntimeProviders>
  );
}
