import type {
  ReactNode
} from "react";
import type {
  AdminPage,
  ApiResult
} from "@/api-client";
import { mapApiFailure } from "@/api-errors";

export function PageState<T>({
  children,
  emptyLabel,
  result
}: {
  children: (page: AdminPage<T>) => ReactNode;
  emptyLabel: string;
  result: ApiResult<AdminPage<T>>;
}) {
  if (!result.ok) {
    return <UnavailableState result={result} />;
  }

  if (result.data.items.length === 0) {
    return <EmptyState label={emptyLabel} />;
  }

  return children(result.data);
}

export function Panel({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className="rounded border border-(--line) bg-(--panel) p-4">
      <h2 className="text-base font-semibold tracking-normal">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-[120px] rounded border border-(--line) bg-(--panel) px-3 py-2">
      <p className="text-xs uppercase text-(--muted)">{label}</p>
      <p className="mt-1 font-semibold tracking-normal">{value}</p>
    </div>
  );
}

export function EmptyState({ label }: { label: string }) {
  return (
    <div className="rounded border border-(--line) bg-(--background) p-3 text-sm text-(--muted)">
      {label}
    </div>
  );
}

export function UnavailableState<T>({ result }: { result: Extract<ApiResult<T>, { ok: false }> }) {
  const mapped = mapApiFailure(result, "Admin");

  return (
    <div className="rounded border border-(--line) bg-(--background) p-3 text-sm">
      <p className="font-medium">{mapped.title}</p>
      <p className="mt-1 text-(--muted)">{mapped.message}</p>
      {process.env.NODE_ENV !== "production" ? (
        <details className="debug-details">
          <summary>Developer details</summary>
          <p>Status {mapped.status ?? "unknown"}</p>
          <p>{mapped.debugMessage}</p>
        </details>
      ) : null}
    </div>
  );
}

export function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs uppercase text-(--muted)">{label}</p>
      <p className="mt-1 truncate font-medium">{value}</p>
    </div>
  );
}

export function AdminSelect({
  children,
  defaultValue,
  label,
  name
}: {
  children: ReactNode;
  defaultValue: string;
  label: string;
  name: string;
}) {
  return (
    <label className="grid min-w-0 gap-1">
      <span className="text-xs uppercase text-(--muted)">{label}</span>
      <select
        className="h-9 min-w-0 rounded border border-(--line) bg-(--panel) px-2 text-sm font-medium"
        defaultValue={defaultValue}
        name={name}
      >
        {children}
      </select>
    </label>
  );
}

export function AdminReasonInput({ placeholder }: { placeholder: string }) {
  return (
    <label className="grid min-w-0 gap-1">
      <span className="text-xs uppercase text-(--muted)">Reason</span>
      <input
        className="h-9 min-w-0 rounded border border-(--line) bg-(--panel) px-2 text-sm"
        minLength={3}
        name="reason"
        placeholder={placeholder}
        required
      />
    </label>
  );
}

export function AdminTextInput({ name, placeholder }: { name: string; placeholder: string }) {
  return (
    <label className="grid min-w-0 gap-1">
      <span className="text-xs uppercase text-(--muted)">{name}</span>
      <input
        className="h-9 min-w-0 rounded border border-(--line) bg-(--panel) px-2 text-sm"
        minLength={3}
        name={name}
        placeholder={placeholder}
        required
      />
    </label>
  );
}

export function AdminJsonInput({ defaultValue }: { defaultValue: string }) {
  return (
    <label className="grid min-w-0 gap-1">
      <span className="text-xs uppercase text-(--muted)">Policy JSON</span>
      <textarea
        className="min-h-24 min-w-0 rounded border border-(--line) bg-(--panel) px-2 py-2 font-mono text-xs"
        defaultValue={defaultValue}
        name="value"
        required
      />
    </label>
  );
}

export function AdminSubmit({ label }: { label: string }) {
  return (
    <button
      className="self-end rounded border border-(--accent) bg-(--accent) px-3 py-2 text-sm font-semibold text-white"
      type="submit"
    >
      {label}
    </button>
  );
}

export function timestampLabel(value: string | null) {
  return value ? new Date(value).toISOString() : "none";
}

export function formatDate(value: string | null) {
  if (!value) {
    return "none";
  }

  return new Date(value).toISOString();
}

export function shorten(value: string) {
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}
