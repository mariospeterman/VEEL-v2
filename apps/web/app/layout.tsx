import type { Metadata, Viewport } from "next";
import { QueryProvider } from "@/query-provider";
import { RealtimeProvider } from "@/realtime-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "VEEL",
  description: "VEEL v2 creator platform shell",
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
      : window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    document.documentElement.dataset.theme = theme;
  } catch {
    document.documentElement.dataset.theme = "dark";
  }
})();
`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <QueryProvider>
          <RealtimeProvider />
          {children}
        </QueryProvider>
      </body>
    </html>
  );
}
