import type { CreateAgeSessionRequest } from "@/api-mutation-types";
import type { readPublicWebEnv } from "@/public-env";

export type AgeProviderPreference = CreateAgeSessionRequest["providerPreference"];

export interface AgeProviderAction {
  action: string;
  label: string;
  logo: "didit" | "persona" | "sumsub" | "veriff" | "yoti";
  providerPreference: AgeProviderPreference;
}

export const ageProviderActions: AgeProviderAction[] = [
  { action: "Recommended", label: "Reusable age ID", logo: "didit", providerPreference: "reusable_first" },
  { action: "Reusable", label: "Didit", logo: "didit", providerPreference: "didit" },
  { action: "Reusable", label: "Yoti", logo: "yoti", providerPreference: "yoti" },
  { action: "Fallback", label: "Persona", logo: "persona", providerPreference: "persona" },
  { action: "Fallback", label: "Sumsub", logo: "sumsub", providerPreference: "sumsub" },
  { action: "Fallback", label: "Veriff", logo: "veriff", providerPreference: "veriff" }
];

export function embeddedWalletProviderConfig(env: ReturnType<typeof readPublicWebEnv>) {
  const runtimeEnabled = env.NEXT_PUBLIC_EMBEDDED_WALLET_RUNTIME_ENABLED;
  const providers = [
    {
      configured: runtimeEnabled && Boolean(env.NEXT_PUBLIC_PRIVY_APP_ID),
      label: "Privy",
      provider: "privy" as const
    },
    {
      configured: runtimeEnabled && Boolean(env.NEXT_PUBLIC_TURNKEY_ORGANIZATION_ID),
      label: "Turnkey",
      provider: "turnkey" as const
    }
  ];

  return {
    enabled: providers.some((provider) => provider.configured),
    providers
  };
}
