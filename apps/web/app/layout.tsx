import type { Metadata, Viewport } from "next";
import "@fontsource-variable/manrope/wght.css";
import "@fontsource-variable/space-grotesk/wght.css";
import "@solana/wallet-adapter-react-ui/styles.css";
import { PwaRuntime } from "./pwa-runtime";
import { readServerPublicWebEnv, serializePublicWebEnvScript } from "@/public-env";
import "./globals.css";

export const metadata: Metadata = {
  title: "WeVid - Frame Your Way",
  description: "WeVid - FRAME YOUR WAY",
  icons: {
    icon: [{ url: "/favicon.ico" }]
  },
  manifest: "/manifest.webmanifest"
};

export const viewport: Viewport = {
  themeColor: "#09090b",
  viewportFit: "cover"
};

const themeScript = `
(() => {
  try {
    const stored = window.localStorage.getItem("veel-theme");
    const theme = stored === "light" || stored === "dark"
      ? stored
      : window.matchMedia("(prefers-color-scheme: light)").matches
        ? "light"
        : "dark";
    document.documentElement.dataset.theme = theme;
  } catch {
    document.documentElement.dataset.theme = "dark";
  }
})();
`;

const developmentPwaResetScript = `
(() => {
  if (!("serviceWorker" in navigator) || !("caches" in window)) return;

  Promise.all([navigator.serviceWorker.getRegistrations(), caches.keys()])
    .then(async ([registrations, cacheNames]) => {
      const veelRegistrations = registrations.filter((registration) => {
        const worker = registration.active ?? registration.waiting ?? registration.installing;
        return worker?.scriptURL.endsWith("/veel-sw.js");
      });
      const veelCacheNames = cacheNames.filter((name) => name.startsWith("wevid-shell-"));
      if (veelRegistrations.length === 0 && veelCacheNames.length === 0) return;

      const results = await Promise.all([
        ...veelRegistrations.map((registration) => registration.unregister()),
        ...veelCacheNames.map((name) => caches.delete(name))
      ]);
      if (results.some(Boolean)) window.location.reload();
    })
    .catch(() => {
      // Development remains usable if browser storage is unavailable.
    });
})();
`;

export const dynamic = "force-dynamic";

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const publicEnv = readServerPublicWebEnv(process.env);
  globalThis.__WEVID_PUBLIC_ENV__ = publicEnv;

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {process.env.NODE_ENV === "development" ? (
          <script dangerouslySetInnerHTML={{ __html: developmentPwaResetScript }} />
        ) : null}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <script dangerouslySetInnerHTML={{ __html: serializePublicWebEnvScript(publicEnv) }} />
      </head>
      <body suppressHydrationWarning>
        {children}
        <PwaRuntime />
      </body>
    </html>
  );
}
