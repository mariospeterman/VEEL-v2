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
