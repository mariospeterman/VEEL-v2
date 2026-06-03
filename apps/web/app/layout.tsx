import type { Metadata, Viewport } from "next";
import { QueryProvider } from "@/query-provider";
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

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
