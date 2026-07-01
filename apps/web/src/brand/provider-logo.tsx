"use client";

import { useState } from "react";
import { Mail, WalletCards } from "lucide-react";
import { FaDiscord, FaGithub, FaGoogle, FaXTwitter } from "react-icons/fa6";

type ProviderLogoName =
  | "backpack"
  | "discord"
  | "email"
  | "didit"
  | "github"
  | "google"
  | "phantom"
  | "persona"
  | "privy"
  | "solflare"
  | "sumsub"
  | "turnkey"
  | "veriff"
  | "wallet"
  | "x"
  | "yoti";

const providerLogoSources: Partial<Record<ProviderLogoName, string>> = {
  backpack: "/provider-icons/backpack.png",
  didit: "/provider-icons/didit.svg",
  phantom: "/provider-icons/phantom.svg",
  privy: "/provider-icons/privy.png",
  solflare: "/provider-icons/solflare.svg",
  turnkey: "/provider-icons/turnkey.svg"
};

export function ProviderLogo({
  label,
  name
}: {
  name: ProviderLogoName;
  label: string;
}) {
  const [assetFailed, setAssetFailed] = useState(false);
  const src = providerLogoSources[name];

  return (
    <span aria-hidden="true" className={`provider-logo provider-logo-${name}`}>
      {src && !assetFailed ? (
        <img
          alt=""
          decoding="async"
          loading="lazy"
          onError={() => setAssetFailed(true)}
          src={src}
        />
      ) : (
        <ProviderIcon label={label} name={name} />
      )}
    </span>
  );
}

function ProviderIcon({ label, name }: { label: string; name: ProviderLogoName }) {
  if (name === "discord") return <FaDiscord size={18} />;
  if (name === "email") return <Mail size={18} />;
  if (name === "github") return <FaGithub size={18} />;
  if (name === "google") return <FaGoogle size={18} />;
  if (name === "x") return <FaXTwitter size={18} />;
  if (name === "didit" || name === "persona" || name === "sumsub" || name === "veriff" || name === "yoti") {
    return <span className="provider-logo-fallback">{providerInitials(label)}</span>;
  }

  return <WalletCards size={18} />;
}

function providerInitials(label: string) {
  return label
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}
