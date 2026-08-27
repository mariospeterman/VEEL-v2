"use client";

import { useState } from "react";
import { Mail, ShieldCheck, WalletCards } from "lucide-react";
import { FaDiscord, FaGithub, FaGoogle, FaXTwitter } from "react-icons/fa6";
import { safeProviderImageSource } from "./provider-image-source";

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
  | "veriff"
  | "wallet"
  | "x"
  | "yoti";

const providerLogoSources: Partial<Record<ProviderLogoName, string>> = {
  backpack: "/provider-icons/backpack.png",
  didit: "/provider-icons/didit.svg",
  phantom: "/provider-icons/phantom.svg",
  persona: "/provider-icons/persona.svg",
  privy: "/provider-icons/privy.png",
  solflare: "/provider-icons/solflare.svg",
  sumsub: "/provider-icons/sumsub.svg",
  veriff: "/provider-icons/veriff.svg",
  yoti: "/provider-icons/yoti.svg"
};

export function ProviderLogo({
  label,
  name,
  source
}: {
  name: ProviderLogoName;
  label: string;
  source?: string | undefined;
}) {
  const [assetFailed, setAssetFailed] = useState(false);
  const src = safeProviderImageSource(source) ?? providerLogoSources[name];

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
    return <ShieldCheck className="provider-logo-neutral" aria-label={label} size={18} />;
  }

  return <WalletCards size={18} />;
}
