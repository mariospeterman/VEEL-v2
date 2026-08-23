import { createHash, randomUUID } from "node:crypto";
import type postgres from "postgres";
import type { StoredPaymentIntent } from "./types.js";

const confirmationVersion = "payment-confirmation-v1";

export async function recordPaymentDurableConfirmation(
  transaction: postgres.TransactionSql,
  input: {
    paymentIntentId: string;
    userId: string;
    productType: StoredPaymentIntent["productType"];
    currency: StoredPaymentIntent["currency"];
    signature: string;
  }
): Promise<void> {
  const rows = await transaction<{
    receipt_id: string;
    receipt_number: string;
    seller_user_id: string | null;
    terms_version: string;
    withdrawal_waiver_version: string;
    withdrawal_waiver_accepted_at: Date | null;
    refund_value_basis: StoredPaymentIntent["refundValueBasis"];
  }[]>`
    with payment as (
      select
        pi.id,
        pi.user_id,
        pi.product_type,
        pi.target_id,
        pi.amount_minor,
        pi.creator_amount_minor,
        pi.platform_fee_amount_minor,
        pi.referral_amount_minor,
        pi.currency,
        pi.reference_address,
        pi.confirmed_signature,
        pi.confirmed_at,
        coalesce(pi.terms_version, 'veel-terms-v1') as terms_version,
        coalesce(pi.withdrawal_waiver_version, 'instant-digital-access-v1') as withdrawal_waiver_version,
        pi.withdrawal_waiver_accepted_at,
        pi.refund_value_basis,
        case
          when pi.product_type in ('tip', 'support', 'creator_subscription') then pi.target_id
          when pi.product_type = 'content_unlock' then (
            select coalesce(
              (select offer.creator_user_id from creator_media_offers offer where offer.id = pi.target_id),
              (select ci.creator_user_id from content_items ci where ci.id = pi.target_id)
            )
          )
          when pi.product_type = 'paid_message' then (
            select coalesce(
              (select request.creator_user_id from structured_creator_requests request where request.payment_intent_id = pi.id),
              (select pmdr.recipient_user_id from paid_message_delivery_requests pmdr where pmdr.payment_intent_id = pi.id)
            )
          )
          when pi.product_type = 'live_pass' then (
            select lr.creator_user_id
            from live_pass_purchase_requests lpr
            join live_rooms lr on lr.id = lpr.room_id
            where lpr.payment_intent_id = pi.id
          )
          when pi.product_type = 'event_access_pass' then (
            select e.creator_user_id
            from event_access_purchase_requests eapr
            join events e on e.id = eapr.event_id
            where eapr.payment_intent_id = pi.id
          )
          else null
        end as seller_user_id
      from payment_intents pi
      where pi.id = ${input.paymentIntentId}
        and pi.user_id = ${input.userId}
        and pi.state = 'confirmed'
      limit 1
    ),
    receipt as (
      insert into receipts (
        id,
        receipt_number,
        buyer_user_id,
        seller_user_id,
        payment_intent_id,
        product_type,
        gross_amount_minor,
        currency
      )
      select
        ${randomUUID()},
        ${receiptNumber(input.paymentIntentId)},
        user_id,
        seller_user_id,
        id,
        product_type,
        amount_minor,
        currency
      from payment
      on conflict (payment_intent_id) where payment_intent_id is not null do update
      set state = receipts.state
      returning id, receipt_number
    ),
    receipt_line as (
      insert into receipt_lines (
        id,
        receipt_id,
        line_type,
        description,
        amount_minor,
        currency
      )
      select
        ${randomUUID()},
        receipt.id,
        'purchase_total',
        ${descriptionForProduct(input.productType)},
        payment.amount_minor,
        payment.currency
      from payment
      join receipt on true
      where not exists (
        select 1
        from receipt_lines existing_line
        where existing_line.receipt_id = receipt.id
          and existing_line.line_type = 'purchase_total'
      )
      returning id
    ),
    ledger as (
      insert into compliance_ledger_entries (
        id,
        event_type,
        product_type,
        settlement_model,
        seller_user_id,
        buyer_user_id,
        payment_intent_id,
        receipt_id,
        gross_amount_minor,
        platform_fee_minor,
        creator_net_amount_minor,
        tax_amount_minor,
        currency,
        fiat_currency,
        seller_of_record,
        metadata,
        immutable_hash
      )
      select
        ${randomUUID()},
        'payment_settled',
        payment.product_type,
        case when payment.seller_user_id is null then 'user_to_platform' else 'user_to_creator_split' end,
        payment.seller_user_id,
        payment.user_id,
        payment.id,
        receipt.id,
        payment.amount_minor,
        case when payment.seller_user_id is null then payment.amount_minor else payment.platform_fee_amount_minor end,
        case
          when payment.seller_user_id is null then null
          else payment.creator_amount_minor
        end,
        null,
        payment.currency,
        'USD',
        case when payment.seller_user_id is null then 'veel' else 'creator' end,
        ${transaction.json({
          confirmationVersion,
          settlementSignature: input.signature,
          refundValueBasis: input.currency === "SOL" ? "original_crypto_amount" : "manual_resolution"
        })}::jsonb ||
          jsonb_build_object(
            'referenceAddress', payment.reference_address,
            'confirmedAt', payment.confirmed_at,
            'platformFeeNetMinor', payment.platform_fee_amount_minor,
            'referralAllocationMinor', payment.referral_amount_minor,
            'termsVersion', payment.terms_version,
            'withdrawalWaiverVersion', payment.withdrawal_waiver_version,
            'withdrawalWaiverAcceptedAt', payment.withdrawal_waiver_accepted_at,
            'refundValueBasis', payment.refund_value_basis
          ),
        ${immutableHash(input.paymentIntentId, "payment_settled")}
      from payment
      join receipt on true
      on conflict (immutable_hash) do nothing
      returning id
    ),
    notification as (
      insert into notifications (
        id,
        user_id,
        kind,
        title,
        body,
        action_url,
        related_resource_type,
        related_resource_id,
        idempotency_key
      )
      select
        ${randomUUID()},
        payment.user_id,
        'payment',
        'Payment confirmed',
        'Your receipt and access confirmation are ready.',
        '/wallet',
        'receipt',
        receipt.id,
        ${`payment-confirmation:${input.paymentIntentId}`}
      from payment
      join receipt on true
      on conflict (user_id, idempotency_key) do nothing
      returning id
    ),
    in_app_delivery as (
      insert into payment_confirmation_deliveries (
        id,
        payment_intent_id,
        receipt_id,
        user_id,
        channel,
        state,
        durable_medium,
        confirmation_version,
        terms_version,
        withdrawal_waiver_version,
        payload,
        delivered_at
      )
      select
        ${randomUUID()},
        payment.id,
        receipt.id,
        payment.user_id,
        'in_app',
        'sent',
        true,
        ${confirmationVersion},
        payment.terms_version,
        payment.withdrawal_waiver_version,
        jsonb_build_object(
          'receiptNumber', receipt.receipt_number,
          'productType', payment.product_type,
          'amountMinor', payment.amount_minor,
          'currency', payment.currency,
          'termsVersion', payment.terms_version,
          'withdrawalWaiverVersion', payment.withdrawal_waiver_version,
          'withdrawalWaiverAcceptedAt', payment.withdrawal_waiver_accepted_at
        ),
        now()
      from payment
      join receipt on true
      on conflict (payment_intent_id, channel) do update
      set
        receipt_id = excluded.receipt_id,
        state = 'sent',
        payload = excluded.payload,
        delivered_at = coalesce(payment_confirmation_deliveries.delivered_at, excluded.delivered_at),
        updated_at = now()
      returning id
    ),
    email_delivery as (
      insert into payment_confirmation_deliveries (
        id,
        payment_intent_id,
        receipt_id,
        user_id,
        channel,
        state,
        durable_medium,
        confirmation_version,
        terms_version,
        withdrawal_waiver_version,
        payload
      )
      select
        ${randomUUID()},
        payment.id,
        receipt.id,
        payment.user_id,
        'email',
        'provider_not_configured',
        true,
        ${confirmationVersion},
        payment.terms_version,
        payment.withdrawal_waiver_version,
        jsonb_build_object(
          'receiptNumber', receipt.receipt_number,
          'productType', payment.product_type,
          'amountMinor', payment.amount_minor,
          'currency', payment.currency,
          'termsVersion', payment.terms_version,
          'withdrawalWaiverVersion', payment.withdrawal_waiver_version,
          'withdrawalWaiverAcceptedAt', payment.withdrawal_waiver_accepted_at,
          'nextStep', 'configure_launch_approved_email_provider'
        )
      from payment
      join receipt on true
      on conflict (payment_intent_id, channel) do update
      set
        receipt_id = excluded.receipt_id,
        payload = excluded.payload,
        updated_at = now()
      returning id
    )
    select
      receipt.id as receipt_id,
      receipt.receipt_number,
      payment.seller_user_id,
      payment.terms_version,
      payment.withdrawal_waiver_version,
      payment.withdrawal_waiver_accepted_at,
      payment.refund_value_basis
    from payment
    join receipt on true
    limit 1
  `;

  const receipt = rows[0];

  if (!receipt) {
    return;
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
    select
      ${randomUUID()},
      ${input.userId},
      'payment_intent',
      ${input.paymentIntentId},
      'payment_durable_confirmation_recorded',
      ${transaction.json({
        receiptId: receipt.receipt_id,
        receiptNumber: receipt.receipt_number,
        sellerUserId: receipt.seller_user_id,
        confirmationVersion,
        termsVersion: receipt.terms_version,
        withdrawalWaiverVersion: receipt.withdrawal_waiver_version,
        withdrawalWaiverAcceptedAt: receipt.withdrawal_waiver_accepted_at?.toISOString() ?? null,
        refundValueBasis: receipt.refund_value_basis
      })}
    where not exists (
      select 1
      from audit_events existing_audit
      where existing_audit.subject_type = 'payment_intent'
        and existing_audit.subject_id = ${input.paymentIntentId}
        and existing_audit.action = 'payment_durable_confirmation_recorded'
    )
  `;
}

function receiptNumber(paymentIntentId: string): string {
  return `VEEL-${paymentIntentId.replaceAll("-", "").slice(0, 16).toUpperCase()}`;
}

function immutableHash(paymentIntentId: string, eventType: string): string {
  return createHash("sha256").update(`${eventType}:${paymentIntentId}`).digest("hex");
}

function descriptionForProduct(productType: StoredPaymentIntent["productType"]): string {
  switch (productType) {
    case "content_unlock":
      return "Digital content access";
    case "paid_message":
      return "Creator commercial interaction";
    case "live_pass":
      return "Live pass access";
    case "event_access_pass":
      return "Event Access Pass";
    case "creator_subscription":
      return "Creator membership access";
    case "platform_subscription":
      return "Platform subscription access";
    case "support":
      return "Creator support";
    case "tip":
    default:
      return "Creator support";
  }
}
