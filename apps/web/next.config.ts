import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  turbopack: {
    root: repoRoot
  },
  typedRoutes: true,
  async redirects() {
    return [
      { source: "/app/home", destination: "/", permanent: false },
      { source: "/app/bits", destination: "/", permanent: false },
      { source: "/app/discover", destination: "/discover", permanent: false },
      { source: "/app/messages", destination: "/messages", permanent: false },
      { source: "/app/profile", destination: "/profile", permanent: false },
      { source: "/app/profile/:handle", destination: "/profile/:handle", permanent: false },
      { source: "/app/media/:contentId", destination: "/content/:contentId", permanent: false },
      { source: "/app/stream/:liveRoomId", destination: "/live/:liveRoomId", permanent: false },
      { source: "/app/activity", destination: "/activity", permanent: false },
      { source: "/app/wallet", destination: "/wallet", permanent: false },
      { source: "/app/settings", destination: "/settings", permanent: false },
      { source: "/app/assistant", destination: "/assistant", permanent: false },
      { source: "/passes", destination: "/tickets", permanent: false },
      { source: "/passes/:ticketId", destination: "/tickets", permanent: false },
      { source: "/event-access/:eventId", destination: "/events/:eventId", permanent: false },
      { source: "/mutuals/activate", destination: "/dating", permanent: false },
      { source: "/mutuals/feed", destination: "/dating", permanent: false },
      { source: "/mutuals/mutuals", destination: "/dating/matches", permanent: false }
    ];
  }
};

export default nextConfig;
