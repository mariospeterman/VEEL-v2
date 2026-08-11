import type { readPublicWebEnv } from "@/public-env";

export function embeddedWalletProviderConfig(env: ReturnType<typeof readPublicWebEnv>) {
  const runtimeEnabled = env.NEXT_PUBLIC_EMBEDDED_WALLET_RUNTIME_ENABLED;
  const provider = {
    configured: runtimeEnabled && Boolean(env.NEXT_PUBLIC_PRIVY_APP_ID),
    label: "Privy",
    provider: "privy" as const
  };

  return {
    enabled: provider.configured,
    provider
  };
}
