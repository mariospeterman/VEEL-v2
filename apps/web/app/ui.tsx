import {
  Card,
  EmptyState,
  Fact,
  Field,
  IconButton,
  Input,
  MediaTile,
  MetricCard,
  PageHeader,
  StatusPill,
  Tabs,
  Textarea,
  Avatar
} from "@veel/ui";
import type { ApiResult } from "@/api-client";
import { mapApiFailure } from "@/api-errors";

export { Avatar, Card, EmptyState, Fact, Field, IconButton, Input, MediaTile, MetricCard, PageHeader, StatusPill, Tabs, Textarea };

export function ErrorState<T>({
  result,
  title,
  context
}: {
  result: ApiResult<T>;
  title?: string;
  context?: string;
}) {
  if (result.ok) {
    return null;
  }

  const mapped = mapApiFailure(result, context ?? title ?? "This area");

  return (
    <Card className="error-state">
      <p className="eyebrow">{mapped.kind.replaceAll("_", " ")}</p>
      <h2>{title ?? mapped.title}</h2>
      <p>{mapped.message}</p>
      {mapped.actionHref && mapped.actionLabel ? (
        <a className="primary-button mt-4" href={mapped.actionHref}>
          {mapped.actionLabel}
        </a>
      ) : null}
      {process.env.NODE_ENV !== "production" ? (
        <details className="debug-details">
          <summary>Developer details</summary>
          <p>Status {mapped.status ?? "unknown"}</p>
          <p>Raw provider/backend message is intentionally not rendered.</p>
        </details>
      ) : null}
    </Card>
  );
}

export function AuthRequiredState({ next = "/app/home" }: { next?: string }) {
  const params = new URLSearchParams({ next });

  return (
    <Card className="auth-state">
      <p className="eyebrow">private feed</p>
      <h2>Enter WeVid to load your feed</h2>
      <p>
        Sign in to safely continue to Home, live, wallet activity, messages, and receipts.
      </p>
      <div className="mt-5 flex flex-wrap gap-3">
        <a className="primary-button" href={`/?mode=login&${params.toString()}`}>
          Enter WeVid
        </a>
        <a className="secondary-button" href="/age">
          Age handoff
        </a>
      </div>
    </Card>
  );
}
