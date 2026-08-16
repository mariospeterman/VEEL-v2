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
    icon: [
      { url: "/favicon.ico" },
      { url: "/flavicon.ico" }
    ]
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

export const dynamic = "force-dynamic";

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const publicEnv = readServerPublicWebEnv(process.env);
  globalThis.__WEVID_PUBLIC_ENV__ = publicEnv;

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
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
