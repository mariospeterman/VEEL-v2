"use client";

import { useRef, useState, type FormEvent } from "react";
import { createMutationIdempotencyKey } from "@/api-mutation-transport";
import {
  ApiMutationError,
  createContentDraft,
  publishContent,
  type CreateContentRequest
} from "@/api-mutations";
import type { VerificationStatus } from "@/api-client";
import { MediaComposer } from "./media-composer";
import {
  nsfwLabels,
  representationModes,
  visibilityValues
} from "./composer-options";
import { Select } from "./create-workspace-fields";

type ComposerFormat = "media" | "text" | "poll";

const formatChoices: Array<{ value: ComposerFormat; title: string; description: string }> = [
  { value: "media", title: "Photos or video", description: "Upload visual media" },
  { value: "text", title: "Write something", description: "Share a text post" },
  { value: "poll", title: "Poll", description: "Ask two to four choices" }
];

export function UniversalComposer({
  storageScope,
  verification
}: {
  storageScope: string | null;
  verification: VerificationStatus | null;
}) {
  const [format, setFormat] = useState<ComposerFormat | null>(null);

  return (
    <section className="grid gap-4">
      <fieldset className="grid gap-3">
        <legend className="text-sm font-semibold">What do you want to share?</legend>
        <div className="grid gap-3 sm:grid-cols-3">
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
        <MediaComposer storageScope={storageScope} verification={verification} />
      ) : format === "text" || format === "poll" ? (
        <TextOrPollComposer format={format} />
      ) : (
        <p className="rounded border border-dashed border-(--line) p-5 text-sm text-(--muted)">
          Choose a format to begin. Your draft remains private until review completes.
        </p>
      )}
    </section>
  );
}

function TextOrPollComposer({ format }: { format: "text" | "poll" }) {
  const [bodyText, setBodyText] = useState("");
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [visibility, setVisibility] = useState<CreateContentRequest["visibility"]>("public");
  const [nsfwLabel, setNsfwLabel] = useState<CreateContentRequest["nsfwLabel"]>("none");
  const [representationMode, setRepresentationMode] = useState<CreateContentRequest["representationMode"]>("self_only");
  const [accepted, setAccepted] = useState(false);
  const [pending, setPending] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idempotencyKey = useRef(createMutationIdempotencyKey());

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const normalizedOptions = options.map((option) => option.trim());
    if (format === "text" && bodyText.trim().length === 0) {
      setError("Write something before submitting.");
      return;
    }
    if (format === "poll" && (question.trim().length === 0 || normalizedOptions.some((option) => option.length === 0))) {
      setError("Add a question and complete every poll choice.");
      return;
    }
    if (!accepted) {
      setError("Confirm that you have the right to share this post.");
      return;
    }

    setPending(true);
    try {
      const draft = await createContentDraft({
        mediaType: format,
        visibility,
        nsfwLabel,
        representationMode,
        contentSafetyPolicyAccepted: true,
        ...(format === "text"
          ? { bodyText: bodyText.trim() }
          : { poll: { question: question.trim(), options: normalizedOptions } })
      }, idempotencyKey.current);
      await publishContent(draft.id, { confirmation: "submit_for_review" });
      setSubmitted(true);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  }

  if (submitted) {
    return (
      <div aria-live="polite" className="rounded border border-(--line) bg-(--panel) p-5">
        <h2 className="font-semibold">Submitted for review</h2>
        <p className="mt-2 text-sm text-(--muted)">Your post remains private until review completes.</p>
      </div>
    );
  }

  return (
    <form className="grid gap-5 rounded border border-(--line) bg-(--panel) p-4 sm:p-5" onSubmit={onSubmit}>
      {format === "text" ? (
        <label className="grid gap-2">
          <span className="font-semibold">Your post</span>
          <textarea
            autoFocus
            className="min-h-48 rounded border border-(--line) bg-(--background) px-3 py-2"
            maxLength={10_000}
            onChange={(event) => setBodyText(event.currentTarget.value)}
            placeholder="Share what is on your mind"
            value={bodyText}
          />
          <span className="text-right text-xs text-(--muted)">{bodyText.length}/10,000</span>
        </label>
      ) : (
        <fieldset className="grid gap-3">
          <legend className="font-semibold">Poll</legend>
          <label className="grid gap-1 text-sm">
            <span className="text-(--muted)">Question</span>
            <input className="rounded border border-(--line) bg-(--background) px-3 py-2" maxLength={500} onChange={(event) => setQuestion(event.currentTarget.value)} value={question} />
          </label>
          {options.map((option, index) => (
            <label className="grid gap-1 text-sm" htmlFor={`poll-option-${index}`} key={index}>
              <span className="text-(--muted)">Choice {index + 1}</span>
              <span className="flex gap-2">
                <input
                  className="min-w-0 flex-1 rounded border border-(--line) bg-(--background) px-3 py-2"
                  id={`poll-option-${index}`}
                  maxLength={200}
                  onChange={(event) => {
                    const nextValue = event.currentTarget.value;
                    setOptions((current) => current.map((value, optionIndex) => optionIndex === index ? nextValue : value));
                  }}
                  value={option}
                />
                {options.length > 2 ? <button aria-label={`Remove choice ${index + 1}`} className="rounded border border-(--line) px-3" onClick={() => setOptions((current) => current.filter((_, optionIndex) => optionIndex !== index))} type="button">Remove</button> : null}
              </span>
            </label>
          ))}
          {options.length < 4 ? <button className="justify-self-start rounded border border-(--line) px-3 py-2 text-sm font-semibold" onClick={() => setOptions((current) => [...current, ""])} type="button">Add choice</button> : null}
        </fieldset>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Select label="Content rating" onChange={(value) => { setNsfwLabel(value); setAccepted(false); }} options={nsfwLabels} value={nsfwLabel} />
        <Select label="Who can see it after approval?" onChange={setVisibility} options={visibilityValues} value={visibility} />
        <Select label="Who is represented?" onChange={(value) => { setRepresentationMode(value); setAccepted(false); }} options={representationModes} value={representationMode} />
      </div>

      <label className="flex min-h-12 items-start gap-3 rounded border border-(--line) bg-(--background) p-3 text-sm leading-5">
        <input checked={accepted} className="mt-0.5" onChange={(event) => setAccepted(event.currentTarget.checked)} type="checkbox" />
        <span>I have the right to share this post, and any identifiable person represented is 18+ and consented.</span>
      </label>
      <button className="min-h-12 rounded bg-(--foreground) px-4 py-3 font-semibold text-(--background) disabled:opacity-50" disabled={pending} type="submit">{pending ? "Submitting…" : "Submit for review"}</button>
      {error ? <p className="text-sm font-medium text-red-400" role="alert">{error}</p> : null}
    </form>
  );
}

function errorMessage(caught: unknown) {
  if (caught instanceof ApiMutationError) return caught.message;
  return caught instanceof Error ? caught.message : "The post could not be submitted.";
}
