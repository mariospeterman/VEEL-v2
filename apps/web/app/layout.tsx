import type { Metadata, Viewport } from "next";
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

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
