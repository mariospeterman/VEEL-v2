import { createHash, randomUUID } from "node:crypto";
import type postgres from "postgres";

export async function grantEventAccessPassEntitlement(
  transaction: postgres.TransactionSql,
  input: {
    userId: string;
    paymentIntentId: string;
  }
): Promise<boolean> {
  const qrToken = newAccessPassQrToken();
  const purchaseRows = await transaction<{ access_pass_type_id: string }[]>`
    select access_pass_type_id
    from event_access_purchase_requests
    where payment_intent_id = ${input.paymentIntentId}
      and buyer_user_id = ${input.userId}
      and state = 'pending_payment'
    limit 1
  `;
  const purchase = purchaseRows[0];

  if (!purchase) {
    await recordEventAccessDeliveryRemediation(transaction, input, "purchase_request_missing");
    return false;
  }

  // Acquire inventory serialization before taking the capacity-query snapshot.
  await transaction`
    select pg_advisory_xact_lock(hashtextextended(${purchase.access_pass_type_id}, 0))
  `;

  const rows = await transaction<{
    access_pass_id: string;
    event_id: string;
    access_pass_type_id: string;
  }[]>`
    with purchase as (
      select
        event_id,
        access_pass_type_id,
        buyer_user_id
      from event_access_purchase_requests
      where payment_intent_id = ${input.paymentIntentId}
        and buyer_user_id = ${input.userId}
        and state = 'pending_payment'
      limit 1
    ),
    inventory as (
      select
        tt.id,
        tt.event_id,
        tt.capacity,
        count(te.id) filter (where te.state in ('active', 'checked_in')) as issued_count
      from event_access_pass_types tt
      join purchase p on p.access_pass_type_id = tt.id and p.event_id = tt.event_id
      left join event_access_passes te on te.access_pass_type_id = tt.id
      group by tt.id
      having count(te.id) filter (where te.state in ('active', 'checked_in')) < tt.capacity
        and count(te.id) filter (where te.state in ('active', 'checked_in')) + (
          select count(*)
          from event_access_purchase_requests other
          where other.access_pass_type_id = tt.id
            and other.payment_intent_id <> ${input.paymentIntentId}
            and other.state = 'pending_payment'
            and other.reserved_until > now()
        ) < tt.capacity
      limit 1
    ),
    inserted_access_pass as (
      insert into event_access_passes (
        id,
        event_id,
        access_pass_type_id,
        holder_user_id,
        payment_intent_id,
        qr_token,
        qr_token_hash
      )
      select
        ${randomUUID()},
        purchase.event_id,
        purchase.access_pass_type_id,
        purchase.buyer_user_id,
        ${input.paymentIntentId},
        ${qrToken},
        ${hashAccessPassQrToken(qrToken)}
      from purchase
      join inventory on inventory.id = purchase.access_pass_type_id
      on conflict (payment_intent_id) do update
      set state = event_access_passes.state
      returning id, event_id, access_pass_type_id
    ),
    updated_purchase as (
      update event_access_purchase_requests tpr
      set state = 'access_pass_granted'
      from inserted_access_pass it
      where tpr.payment_intent_id = ${input.paymentIntentId}
      returning it.id, it.event_id, it.access_pass_type_id
    )
    select
      id as access_pass_id,
      event_id,
      access_pass_type_id
    from updated_purchase
    limit 1
  `;
  const accessPass = rows[0];

  if (!accessPass) {
    await recordEventAccessDeliveryRemediation(transaction, input, "inventory_unavailable");
    return false;
  }

  await transaction`
    insert into audit_events (
      id,
      actor_user_id,
      subject_type,
      subject_id,
      action,
      metadata
    )
    values (
      ${randomUUID()},
      ${input.userId},
      'event',
      ${accessPass.event_id},
      'event_access_pass_granted',
      ${transaction.json({
        paymentIntentId: input.paymentIntentId,
        accessPassId: accessPass.access_pass_id,
        accessPassTypeId: accessPass.access_pass_type_id
      })}
    )
  `;

  return true;
}

async function recordEventAccessDeliveryRemediation(
  transaction: postgres.TransactionSql,
  input: { userId: string; paymentIntentId: string },
  reason: "inventory_unavailable" | "purchase_request_missing"
): Promise<void> {
  await transaction`
    insert into support_cases (
      id, requester_user_id, subject_type, subject_id, category, state, priority, updated_at
    )
    select
      ${randomUUID()}, ${input.userId}, 'payment', ${input.paymentIntentId},
      'access', 'pending_internal', 'standard', now()
    where not exists (
      select 1
      from support_cases
      where subject_type = 'payment'
        and subject_id = ${input.paymentIntentId}
        and category = 'access'
        and state in ('open', 'pending_user', 'pending_internal')
    )
  `;

  await transaction`
    insert into audit_events (
      id, actor_user_id, subject_type, subject_id, action, idempotency_key, metadata
    ) values (
      ${randomUUID()}, ${input.userId}, 'payment_intent', ${input.paymentIntentId},
      'event_access_delivery_remediation_required',
      ${`event-access-delivery:${input.paymentIntentId}`},
      ${transaction.json({ reason, nonCustodialBoundary: "support_review_only" })}
    )
    on conflict (actor_user_id, action, idempotency_key)
      where actor_user_id is not null and idempotency_key is not null
      do nothing
  `;
}

function newAccessPassQrToken(): string {
  return `veel_access_pass_${randomUUID().replaceAll("-", "")}`;
}

function hashAccessPassQrToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
