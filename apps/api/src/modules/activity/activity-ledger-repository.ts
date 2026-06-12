import type postgres from "postgres";
import { type ActivityRow, toActivityPage } from "./activity-repository-mappers.js";
import type { ListActivityInput } from "./types.js";

export async function listActivity(sql: postgres.Sql, input: ListActivityInput) {
  const rows = await sql<ActivityRow[]>`
    with target_user as (
      select id
      from users
      where supabase_user_id = ${input.supabaseUserId}
      limit 1
    ),
    payment_activity as (
      select
        pi.id,
        'payment_intent' as kind,
        initcap(replace(pi.product_type, '_', ' ')) as title,
        pi.state,
        pi.product_type,
        pi.target_id,
        pi.amount_minor,
        pi.currency,
        pi.id as payment_intent_id,
        pi.coalesce_signature as signature,
        pi.reference_address,
        r.id as receipt_id,
        r.receipt_number,
        r.state as receipt_state,
        in_app_delivery.state as in_app_confirmation_state,
        email_delivery.state as email_confirmation_state,
        case
          when pi.state <> 'confirmed' then 'not_applicable'
          when pi.withdrawal_waiver_required and pi.withdrawal_waiver_accepted_at is not null then 'waived_after_immediate_access'
          else 'review_required'
        end as withdrawal_right_status,
        (pi.state = 'confirmed') as support_review_available,
        latest_refund.state as latest_refund_request_state,
        pi.created_at,
        pi.confirmed_at
      from (
        select
          *,
          coalesce(confirmed_signature, submitted_signature) as coalesce_signature
        from payment_intents
      ) pi
      join target_user tu on tu.id = pi.user_id
      left join receipts r on r.payment_intent_id = pi.id
      left join payment_confirmation_deliveries in_app_delivery
        on in_app_delivery.payment_intent_id = pi.id
        and in_app_delivery.channel = 'in_app'
      left join payment_confirmation_deliveries email_delivery
        on email_delivery.payment_intent_id = pi.id
        and email_delivery.channel = 'email'
      left join lateral (
        select rd.state
        from refunds_and_disputes rd
        where rd.payment_intent_id = pi.id
          and rd.reporter_user_id = pi.user_id
        order by rd.created_at desc
        limit 1
      ) latest_refund on true
    ),
    wallet_activity as (
      select
        wtr.id,
        'wallet_transaction' as kind,
        'Wallet transaction' as title,
        wtr.state,
        pi.product_type,
        pi.target_id,
        wtr.amount_minor,
        wtr.currency,
        wtr.payment_intent_id,
        wtr.signature,
        wtr.reference_address,
        null::uuid as receipt_id,
        null::text as receipt_number,
        null::text as receipt_state,
        null::text as in_app_confirmation_state,
        null::text as email_confirmation_state,
        null::text as withdrawal_right_status,
        false as support_review_available,
        null::text as latest_refund_request_state,
        wtr.created_at,
        wtr.confirmed_at
      from wallet_transaction_records wtr
      join target_user tu on tu.id = wtr.user_id
      left join payment_intents pi on pi.id = wtr.payment_intent_id
    )
    select *
    from (
      select * from payment_activity
      union all
      select * from wallet_activity
    ) activity
    where (${input.cursor ?? null}::timestamptz is null or created_at < ${input.cursor ?? null}::timestamptz)
    order by created_at desc
    limit ${input.limit + 1}
  `;

  return toActivityPage(rows, input.limit);
}

export async function listPaymentActivity(sql: postgres.Sql, input: ListActivityInput) {
  const rows = await sql<ActivityRow[]>`
    with target_user as (
      select id
      from users
      where supabase_user_id = ${input.supabaseUserId}
      limit 1
    )
    select
      pi.id,
      'payment_intent' as kind,
      initcap(replace(pi.product_type, '_', ' ')) as title,
      pi.state,
      pi.product_type,
      pi.target_id,
      pi.amount_minor,
      pi.currency,
      pi.id as payment_intent_id,
      coalesce(pi.confirmed_signature, pi.submitted_signature) as signature,
      pi.reference_address,
      r.id as receipt_id,
      r.receipt_number,
      r.state as receipt_state,
      in_app_delivery.state as in_app_confirmation_state,
      email_delivery.state as email_confirmation_state,
      case
        when pi.state <> 'confirmed' then 'not_applicable'
        when pi.withdrawal_waiver_required and pi.withdrawal_waiver_accepted_at is not null then 'waived_after_immediate_access'
        else 'review_required'
      end as withdrawal_right_status,
      (pi.state = 'confirmed') as support_review_available,
      latest_refund.state as latest_refund_request_state,
      pi.created_at,
      pi.confirmed_at
    from payment_intents pi
    join target_user tu on tu.id = pi.user_id
    left join receipts r on r.payment_intent_id = pi.id
    left join payment_confirmation_deliveries in_app_delivery
      on in_app_delivery.payment_intent_id = pi.id
      and in_app_delivery.channel = 'in_app'
    left join payment_confirmation_deliveries email_delivery
      on email_delivery.payment_intent_id = pi.id
      and email_delivery.channel = 'email'
    left join lateral (
      select rd.state
      from refunds_and_disputes rd
      where rd.payment_intent_id = pi.id
        and rd.reporter_user_id = pi.user_id
      order by rd.created_at desc
      limit 1
    ) latest_refund on true
    where (${input.cursor ?? null}::timestamptz is null or pi.created_at < ${input.cursor ?? null}::timestamptz)
    order by pi.created_at desc
    limit ${input.limit + 1}
  `;

  return toActivityPage(rows, input.limit);
}
