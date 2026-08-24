import type {
  AdminPage,
  AdminPaymentCommercialPolicy,
  AnalyticsProjectionHealth,
  ApiResult
} from "@/api-client";
import {
  enqueueAnalyticsProjectionJobAction,
  updatePaymentCommercialPolicyAction
} from "./actions";

export function AnalyticsOperations({
  canRecompute,
  health
}: {
  canRecompute: boolean;
  health: ApiResult<AnalyticsProjectionHealth>;
}) {
  return (
    <OperationPanel title="Analytics projection health">
      {!health.ok ? <Failure message={health.message} /> : (
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Fact label="State" value={health.data.state} />
            <Fact label="Data lag" value={health.data.lagSeconds == null ? "Unavailable" : `${health.data.lagSeconds}s`} />
            <Fact label="Reconciliation" value={health.data.latestReconciliationState ?? "No run"} />
            <Fact label="Dead letters" value={String(health.data.deadLetterJobCount)} />
          </div>
          {canRecompute ? (
            <form action={enqueueAnalyticsProjectionJobAction} className="grid gap-3 border-t border-(--line) pt-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Projection action">
                  <select className={controlClass} defaultValue="backfill" name="jobType">
                    <option value="backfill">Backfill</option>
                    <option value="reconciliation">Reconcile</option>
                  </select>
                </Field>
                <Field label="Start date"><input className={controlClass} name="startDate" required type="date" /></Field>
                <Field label="End date"><input className={controlClass} name="endDate" required type="date" /></Field>
              </div>
              <Field label="Audit reason"><input className={controlClass} maxLength={500} minLength={3} name="reason" required /></Field>
              <button className={buttonClass} type="submit">Queue projection job</button>
            </form>
          ) : null}
        </div>
      )}
    </OperationPanel>
  );
}

export function PaymentPolicyOperations({
  canWrite,
  policies
}: {
  canWrite: boolean;
  policies: ApiResult<AdminPage<AdminPaymentCommercialPolicy>>;
}) {
  return (
    <OperationPanel title="Payments and unlocks">
      <p className="mb-4 text-sm text-(--muted)">Overrides apply only to new quotes. Existing payment intents keep their recorded policy revision.</p>
      {!policies.ok ? <Failure message={policies.message} /> : policies.data.items.length === 0 ? (
        <p className="text-sm text-(--muted)">No overrides. Environment defaults are active.</p>
      ) : (
        <div className="grid gap-3">
          {policies.data.items.map((policy) => (
            <form action={updatePaymentCommercialPolicyAction} className="grid gap-3 rounded-xl border border-(--line) bg-(--background) p-4" key={policy.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold">{policy.productType} · {policy.currency}</p>
                <p className="text-xs text-(--muted)">Revision {policy.revision}</p>
              </div>
              <input name="productType" type="hidden" value={policy.productType} />
              <input name="currency" type="hidden" value={policy.currency} />
              <div className="grid gap-3 sm:grid-cols-2">
                <NumberField disabled={!canWrite} label="Minimum atomic amount" min={1} name="minimumAmountMinor" value={policy.minimumAmountMinor} />
                <NumberField disabled={!canWrite} label="Platform fee bps" max={9_999} min={0} name="platformFeeBps" value={policy.platformFeeBps} />
                <NumberField disabled={!canWrite} label="Referral share bps" max={10_000} min={0} name="referralShareOfPlatformFeeBps" value={policy.referralShareOfPlatformFeeBps} />
                <NumberField disabled={!canWrite} label="Quote lifetime seconds" max={1_800} min={60} name="quoteTtlSeconds" value={policy.quoteTtlSeconds} />
              </div>
              <Field label="State">
                <select className={controlClass} defaultValue={policy.state} disabled={!canWrite} name="state">
                  <option value="active">Active</option><option value="inactive">Inactive</option>
                </select>
              </Field>
              <Field label="Audit reason"><input className={controlClass} defaultValue={policy.reason} disabled={!canWrite} maxLength={500} minLength={3} name="reason" required /></Field>
              {canWrite ? <button className={buttonClass} type="submit">Save policy</button> : null}
            </form>
          ))}
        </div>
      )}
    </OperationPanel>
  );
}

function OperationPanel({ children, title }: { children: import("react").ReactNode; title: string }) {
  return <section className="overflow-hidden rounded-2xl border border-(--line) bg-(--panel) p-5"><h2 className="mb-4 text-lg font-semibold">{title}</h2>{children}</section>;
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 rounded-xl bg-(--background) p-3"><p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-(--muted)">{label}</p><p className="mt-1 truncate text-sm font-semibold">{value}</p></div>;
}

function Field({ children, label }: { children: import("react").ReactNode; label: string }) {
  return <label className="grid gap-1 text-xs text-(--muted)"><span>{label}</span>{children}</label>;
}

function NumberField({ disabled, label, max, min, name, value }: { disabled: boolean; label: string; max?: number; min: number; name: string; value: number }) {
  return <Field label={label}><input className={controlClass} defaultValue={value} disabled={disabled} max={max} min={min} name={name} required step={1} type="number" /></Field>;
}

function Failure({ message }: { message: string }) {
  return <p className="text-sm text-(--muted)">{message}</p>;
}

const controlClass = "min-h-11 w-full rounded-xl border border-(--line) bg-(--panel) px-3 text-(--foreground) disabled:opacity-60";
const buttonClass = "min-h-11 justify-self-start rounded-xl bg-(--foreground) px-4 font-semibold text-(--background)";
