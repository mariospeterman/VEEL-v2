"use client";

import { useState } from "react";
import type { VerificationStatus } from "@/api-client";
import { MediaComposer } from "./media-composer";
import { LiveCreateWorkspace } from "./live-create-workspace";

type ComposerFormat = "media" | "live";

const formatChoices: Array<{
  value: ComposerFormat;
  title: string;
  description: string;
}> = [
  {
    value: "media",
    title: "Add photos or videos",
    description: "Share one photo, a carousel, or a video"
  },
  {
    value: "live",
    title: "Go live",
    description: "Use this device's camera, or connect streaming software"
  }
];

export function UniversalComposer({
  canSchedule,
  initialDistributionMode,
  initialFormat,
  storageScope,
  verification
}: {
  canSchedule: boolean;
  initialDistributionMode: "post" | "moment";
  initialFormat: ComposerFormat | null;
  storageScope: string | null;
  verification: VerificationStatus | null;
}) {
  const [format, setFormat] = useState<ComposerFormat | null>(initialFormat);

  return (
    <section className="grid gap-4">
      <fieldset className="grid gap-3">
        <legend className="text-sm font-semibold">What do you want to create?</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {formatChoices.map((choice) => (
            <button
              aria-pressed={format === choice.value}
              className={`min-h-24 rounded border p-4 text-left transition-colors ${
                format === choice.value
                  ? "border-(--accent) bg-(--accent-soft)"
                  : "border-(--line) bg-(--panel) hover:border-(--muted)"
              }`}
              key={choice.value}
              onClick={() => setFormat(choice.value)}
              type="button"
            >
              <span className="block font-semibold">{choice.title}</span>
              <span className="mt-1 block text-sm text-(--muted)">{choice.description}</span>
            </button>
          ))}
        </div>
      </fieldset>

      {format === "media" ? (
        <MediaComposer
          canSchedule={canSchedule}
          initialDistributionMode={initialDistributionMode}
          storageScope={storageScope}
          verification={verification}
        />
      ) : format === "live" ? (
        <LiveCreateWorkspace enabled={verification?.capabilities.canUploadMedia === true} />
      ) : (
        <p className="rounded border border-dashed border-(--line) p-5 text-sm text-(--muted)">
          Choose photos or videos, or start a live room. Draft media stays private until review completes.
        </p>
      )}
    </section>
  );
}
