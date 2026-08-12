import { parseServerEnv } from "@veel/config";
import { createResendPaymentConfirmationEmailProvider } from "./payment-confirmation-email.js";

const config = parseServerEnv(process.env);

if (
  config.TRANSACTIONAL_EMAIL_PROVIDER !== "resend" ||
  !config.RESEND_API_KEY ||
  !config.TRANSACTIONAL_EMAIL_FROM ||
  !config.TRANSACTIONAL_EMAIL_SMOKE_TO
) {
  console.log(
    "SKIPPED transactional email smoke: configure TRANSACTIONAL_EMAIL_PROVIDER=resend, RESEND_API_KEY, TRANSACTIONAL_EMAIL_FROM, and TRANSACTIONAL_EMAIL_SMOKE_TO."
  );
  process.exit(0);
}

const provider = createResendPaymentConfirmationEmailProvider({
  apiKey: config.RESEND_API_KEY,
  from: config.TRANSACTIONAL_EMAIL_FROM,
  replyTo: config.TRANSACTIONAL_EMAIL_REPLY_TO,
  webUrl: config.WEB_URL
});

const outcome = await provider.send({
  deliveryId: `smoke-${Date.now()}`,
  leaseToken: "smoke",
  attemptCount: 1,
  paymentIntentId: "00000000-0000-4000-8000-000000000000",
  receiptId: null,
  userId: "smoke",
  to: config.TRANSACTIONAL_EMAIL_SMOKE_TO,
  receiptNumber: "VEEL-SMOKE",
  productType: "platform_subscription",
  amountMinor: 0,
  currency: "SOL",
  termsVersion: "veel-terms-v1",
  withdrawalWaiverVersion: "instant-digital-access-v1",
  withdrawalWaiverAcceptedAt: new Date().toISOString()
});

if (outcome.state !== "sent") {
  console.error(`FAILED transactional email smoke: ${outcome.failureCode}`);
  process.exit(1);
}

console.log(`SENT transactional email smoke: ${outcome.providerMessageId ?? "provider-message-id-unavailable"}`);
