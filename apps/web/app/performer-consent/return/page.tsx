"use client";

import { useEffect } from "react";

export default function PerformerConsentReturnPage() {
  useEffect(() => {
    const token = sessionStorage.getItem("veel_performer_invitation");
    window.location.replace(token ? `/performer-consent/${encodeURIComponent(token)}` : "/");
  }, []);

  return (
    <main className="grid min-h-dvh place-items-center bg-(--background) px-4 text-(--foreground)">
      <p className="text-sm text-(--muted)">Returning to consent review</p>
    </main>
  );
}
