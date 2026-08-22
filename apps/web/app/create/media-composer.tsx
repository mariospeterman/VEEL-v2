"use client";

import { useState } from "react";
import type { VerificationStatus } from "@/api-client";
import { CreateWorkspace } from "./create-workspace";
import { ImageComposer } from "./image-composer";

export function MediaComposer(props: {
  storageScope: string | null;
  verification: VerificationStatus | null;
}) {
  const [kind, setKind] = useState<"photos" | "video" | null>(null);

  if (kind === "photos") return <ImageComposer {...props} onBack={() => setKind(null)} />;
  if (kind === "video") {
    return (
      <div className="grid gap-3">
        <button className="justify-self-start text-sm font-semibold text-(--accent-text)" onClick={() => setKind(null)} type="button">
          ← Change media type
        </button>
        <CreateWorkspace {...props} />
      </div>
    );
  }

  return (
    <fieldset className="grid gap-3 rounded border border-(--line) bg-(--panel) p-4 sm:p-5">
      <legend className="px-1 font-semibold">Choose media</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        <button className="min-h-28 rounded border border-(--line) bg-(--background) p-4 text-left hover:border-(--accent)" onClick={() => setKind("photos")} type="button">
          <span className="block font-semibold">Photos</span>
          <span className="mt-1 block text-sm text-(--muted)">One image or a carousel of up to 10</span>
        </button>
        <button className="min-h-28 rounded border border-(--line) bg-(--background) p-4 text-left hover:border-(--accent)" onClick={() => setKind("video")} type="button">
          <span className="block font-semibold">Video</span>
          <span className="mt-1 block text-sm text-(--muted)">Resumable private video upload</span>
        </button>
      </div>
    </fieldset>
  );
}
