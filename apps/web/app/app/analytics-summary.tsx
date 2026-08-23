import type { AnalyticsQueryRequest, AnalyticsQueryResponse, ApiResult } from "@/api-client";
import { Card, ErrorState, Fact, StatusPill } from "../ui";

export function AnalyticsSummary({
  description,
  queries,
  title
}: {
  description: string;
  queries: Array<ApiResult<AnalyticsQueryResponse>>;
  title: string;
}) {
  const failed = queries.find((query) => !query.ok);
  if (failed && !failed.ok) {
    return <ErrorState result={failed} title={`${title} unavailable`} context={title} />;
  }

  const results = queries.flatMap((query) => query.ok ? [query.data] : []);
  const metrics = results.flatMap((result) => result.metrics);
  const freshest = results[0];

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-normal">{title}</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-(--muted)">{description}</p>
        </div>
        <StatusPill tone={freshest?.freshness === "fresh" ? "good" : "warn"}>
          {freshest?.freshness ?? "unavailable"}
        </StatusPill>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {metrics.map((metric) => {
          const point = metric.points[0];
          const currency = metric.dimensions.currency;
          return (
            <Fact
              key={`${metric.metricKey}-${currency ?? "all"}-${metric.dimensions.productType ?? "all"}`}
              label={`${metric.label}${currency ? ` · ${currency}` : ""}`}
              value={formatMetric(point?.value ?? null, metric.unit, currency)}
            />
          );
        })}
      </div>
      <div className="mt-4 grid gap-1 border-t border-(--line) pt-3 text-xs text-(--muted)">
        <p>Data through {freshest?.dataThrough ? new Date(freshest.dataThrough).toLocaleString() : "not yet available"} · UTC · metric definition v{metrics[0]?.definitionVersion ?? 1}</p>
        <p>Small audiences are hidden automatically. Confirmed earnings are historical ledger facts, never a wallet balance.</p>
      </div>
      {results.flatMap((result) => result.insights).slice(0, 2).map((insight) => (
        <div className="mt-3 rounded border border-(--line) bg-(--background) p-3 text-sm" key={insight.metricKey}>
          <p className="font-medium">{insight.observation}</p>
          <p className="mt-1 text-(--muted)">{insight.experiment}</p>
        </div>
      ))}
    </Card>
  );
}

export function analyticsWindow(days: number, offsetDays = 0): AnalyticsQueryRequest["window"] {
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - offsetDays);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - days + 1);
  return { startDate: isoDate(start), endDate: isoDate(end) };
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function formatMetric(value: string | number | null, unit: string, currency?: "SOL" | "USDC") {
  if (value === null) return "Hidden for privacy";
  if (unit === "ratio") return `${Math.round(Number(value) * 1000) / 10}%`;
  if (unit === "seconds") {
    const seconds = BigInt(String(value));
    const hours = seconds / 3600n;
    const minutes = (seconds % 3600n) / 60n;
    return hours > 0n ? `${hours}h ${minutes}m` : `${minutes}m`;
  }
  if (unit === "minor_units" && currency) return formatNativeMinor(String(value), currency);
  return BigInt(String(value)).toLocaleString("en-US");
}

function formatNativeMinor(value: string, currency: "SOL" | "USDC") {
  const decimals = currency === "SOL" ? 9 : 6;
  const scale = 10n ** BigInt(decimals);
  const amount = BigInt(value);
  const whole = amount / scale;
  const fraction = (amount % scale).toString().padStart(decimals, "0").replace(/0+$/, "").slice(0, 4);
  return `${whole.toLocaleString("en-US")}${fraction ? `.${fraction}` : ""} ${currency}`;
}
