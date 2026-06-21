"use client";

import { WalletCards } from "lucide-react";

type ProviderLogoName = "backpack" | "phantom" | "privy" | "solflare" | "turnkey" | "wallet";

const providerLogoSources: Partial<Record<ProviderLogoName, string>> = {
  backpack: "/provider-icons/backpack.png",
  phantom: "/provider-icons/phantom.svg",
  privy: "/provider-icons/privy.png",
  solflare: "/provider-icons/solflare.svg",
  turnkey: "/provider-icons/turnkey.svg"
};

export function ProviderLogo({
  name,
  label
}: {
  name: ProviderLogoName;
  label: string;
}) {
  const src = providerLogoSources[name];

  return (
    <span aria-hidden="true" className={`provider-logo provider-logo-${name}`} title={label}>
      {src ? <img alt="" decoding="async" loading="lazy" src={src} /> : <WalletCards size={18} />}
    </span>
  );
}
