import { randomUUID } from "node:crypto";
import type postgres from "postgres";

export async function grantContentUnlockEntitlement(
  transaction: postgres.TransactionSql,
  input: {
    userId: string;
    contentId: string;
    paymentIntentId: string;
  }
): Promise<void> {
  const rows = await transaction<{ id: string }[]>`
    with existing_entitlement as (
      select id
      from entitlements
      where user_id = ${input.userId}
        and target_type = 'content'
        and target_id = ${input.contentId}
        and product_type = 'content_unlock'
        and state = 'active'
        and starts_at <= now()
        and (ends_at is null or ends_at > now())
      limit 1
    ),
    inserted_entitlement as (
      insert into entitlements (
        id,
        user_id,
        target_type,
        target_id,
        product_type,
        payment_intent_id
      )
      select
        ${randomUUID()},
        ${input.userId},
        'content',
        ${input.contentId},
        'content_unlock',
        ${input.paymentIntentId}
      where not exists (select 1 from existing_entitlement)
      on conflict (payment_intent_id) do update
      set state = entitlements.state
      returning id
    )
    select id from inserted_entitlement
    union all
    select id from existing_entitlement
    limit 1
  `;
  const entitlementId = rows[0]?.id;

  if (!entitlementId) {
    return;
  }

  await transaction`
    insert into entitlement_events (
      id,
      entitlement_id,
      actor_user_id,
      action,
      payment_intent_id
    )
    values (
      ${randomUUID()},
      ${entitlementId},
      ${input.userId},
      'granted',
      ${input.paymentIntentId}
    )
  `;

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
      'content',
      ${input.contentId},
      'content_unlock_entitlement_granted',
      ${transaction.json({ paymentIntentId: input.paymentIntentId })}
    )
  `;
}

export async function grantLivePassEntitlement(
  transaction: postgres.TransactionSql,
  input: {
    userId: string;
    paymentIntentId: string;
  }
): Promise<void> {
  const rows = await transaction<{
    live_pass_id: string;
    room_id: string;
    entitlement_id: string;
    expires_at: Date;
  }[]>`
    with purchase as (
      select
        room_id,
        buyer_user_id,
        duration_minutes
      from live_pass_purchase_requests
      where payment_intent_id = ${input.paymentIntentId}
        and buyer_user_id = ${input.userId}
      limit 1
    ),
    inserted_live_pass as (
      insert into live_passes (
        id,
        room_id,
        user_id,
        payment_intent_id,
        duration_minutes,
        expires_at
      )
      select
        ${randomUUID()},
        room_id,
        buyer_user_id,
        ${input.paymentIntentId},
        duration_minutes,
        now() + (duration_minutes::text || ' minutes')::interval
      from purchase
      on conflict (payment_intent_id) do update
      set state = live_passes.state
      returning id, room_id, user_id, payment_intent_id, expires_at
    ),
    inserted_entitlement as (
      insert into entitlements (
        id,
        user_id,
        target_type,
        target_id,
        product_type,
        payment_intent_id,
        ends_at
      )
      select
        ${randomUUID()},
        user_id,
        'live_room',
        room_id,
        'live_pass',
        payment_intent_id,
        expires_at
      from inserted_live_pass
      on conflict (payment_intent_id) do update
      set ends_at = excluded.ends_at
      returning id
    )
    select
      ilp.id as live_pass_id,
      ilp.room_id,
      ie.id as entitlement_id,
      ilp.expires_at
    from inserted_live_pass ilp
    join inserted_entitlement ie on true
    limit 1
  `;
  const livePass = rows[0];

  if (!livePass) {
    return;
  }

  await transaction`
    insert into entitlement_events (
      id,
      entitlement_id,
      actor_user_id,
      action,
      payment_intent_id
    )
    values (
      ${randomUUID()},
      ${livePass.entitlement_id},
      ${input.userId},
      'granted',
      ${input.paymentIntentId}
    )
  `;

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
      'live_room',
      ${livePass.room_id},
      'live_pass_entitlement_granted',
      ${transaction.json({
        paymentIntentId: input.paymentIntentId,
        livePassId: livePass.live_pass_id,
        expiresAt: livePass.expires_at.toISOString()
      })}
    )
  `;
}
