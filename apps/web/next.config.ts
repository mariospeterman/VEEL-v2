import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

loadRepoRootEnv(repoRoot);

function loadRepoRootEnv(root: string) {
  const envPath = resolve(root, ".env");
  if (!existsSync(envPath)) return;

  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;

    const key = trimmed.slice(0, separator).trim();
    const rawValue = trimmed.slice(separator + 1).trim();
    if (process.env[key] !== undefined) continue;
    process.env[key] = rawValue.replace(/^['"]|['"]$/g, "");
  }
}

const nextConfig: NextConfig = {
  allowedDevOrigins: allowedDevOrigins(),
  devIndicators: false,
  reactStrictMode: true,
  turbopack: {
    root: repoRoot
  },
  typedRoutes: true,
  async redirects() {
    return [
      { source: "/activity", destination: "/app/activity", permanent: false },
      { source: "/assistant", destination: "/app/assistant", permanent: false },
      { source: "/create", destination: "/app/create", permanent: false },
      { source: "/discover", destination: "/app/bits", permanent: false },
      { source: "/messages", destination: "/app/messages", permanent: false },
      { source: "/profile", destination: "/app/profile", permanent: false },
      { source: "/settings", destination: "/app/settings", permanent: false },
      { source: "/studio", destination: "/app/studio", permanent: false },
      { source: "/subscriptions", destination: "/app/subscriptions", permanent: false },
      { source: "/wallet", destination: "/app/wallet", permanent: false },
      { source: "/app/profile/:handle", destination: "/profile/:handle", permanent: false },
      { source: "/app/media/:contentId", destination: "/content/:contentId", permanent: false },
      { source: "/app/stream/:liveRoomId", destination: "/live/:liveRoomId", permanent: false },
      { source: "/events/:eventId", destination: "/event-access/:eventId", permanent: false },
      { source: "/mutuals/activate", destination: "/mutuals/feed", permanent: false },
      { source: "/mutuals/mutuals", destination: "/mutuals", permanent: false }
    ];
  }
};

export default nextConfig;

function allowedDevOrigins() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) return [];

  try {
    const { hostname } = new URL(appUrl);
    return hostname.includes("ngrok-free.app") ? [hostname] : [];
  } catch {
    return [];
  }
}
