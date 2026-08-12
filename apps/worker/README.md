# apps/worker

Worker process for provider webhooks, reconciliation, moderation, media status refreshes, and retries.

The process runs notification delivery, durable payment-confirmation email, and eligible subscription collection ticks immediately at startup and then every `WORKER_TICK_INTERVAL_MS` (60 seconds by default). A failed task is isolated from the other queues, overlapping ticks are serialized, and `SIGINT`/`SIGTERM` wait for the active tick before shutdown. `WORKER_BATCH_LIMIT` bounds each queue lease.

Provider-event replay remains operator-requested and is not polled by the recurring scheduler.

Notification delivery uses the `notification-deliveries` queue. Browser push remains disabled unless all server-side VAPID settings are present:

- `WEB_PUSH_VAPID_SUBJECT`
- `WEB_PUSH_VAPID_PUBLIC_KEY`
- `WEB_PUSH_VAPID_PRIVATE_KEY`

The public key is also returned through the API push-config route for browser enrollment. The private key stays worker/server-only.
