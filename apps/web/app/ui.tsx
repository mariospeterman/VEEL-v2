import type { ReactNode } from "react";
import type { ApiResult } from "@/api-client";
import { mapApiFailure } from "@/api-errors";

export function PageHeader({
  eyebrow,
  title,
  children,
  action
}: {
  eyebrow: string;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        {children ? <p className="page-kicker">{children}</p> : null}
      </div>
      {action ? <div className="page-action">{action}</div> : null}
    </header>
  );
}

export function Card({
  children,
  className = "",
  id
}: {
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return <section className={`ui-card ${className}`} id={id}>{children}</section>;
}

export function EmptyState({
  title,
  children,
  action
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <Card className="empty-state">
      <h2>{title}</h2>
      {children ? <p>{children}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </Card>
  );
}

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
      <h2>Enter VEEL to load your feed</h2>
      <p>
        Home, live rail, wallet, messages, and receipts use backend-verified session state.
        Sign in to continue without exposing raw API errors.
      </p>
      <div className="mt-5 flex flex-wrap gap-3">
        <a className="primary-button" href={`/enter?${params.toString()}`}>
          Enter VEEL
        </a>
        <a className="secondary-button" href="/age">
          Age handoff
        </a>
      </div>
    </Card>
  );
}

export function StatusPill({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "good" | "warn" | "danger" }) {
  return (
    <span className="status-pill" data-tone={tone}>
      {children}
    </span>
  );
}

export function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="fact">
      <p>{label}</p>
      <strong>{value}</strong>
    </div>
  );
}

export function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="metric-card">
      <p>{label}</p>
      <strong>{value}</strong>
    </Card>
  );
}
