# apps/worker

Worker process for durable reconciliation, delivery, moderation, publication, provider actions, and retries. Signed provider webhooks enter through the API, not through a second worker ingress.

The process runs all ten registered queues immediately at startup and then every `WORKER_TICK_INTERVAL_MS` (60 seconds by default):

- `analytics-projections`
- `subscription-authorization-reconciliation`
- `subscription-collections`
- `notification-deliveries`
- `payment-confirmation-emails`
- `provider-event-replays`
- `scheduled-publications`
- `live-safety`
- `media-moderation`
- `media-asset-cleanups`

A failed task is isolated from the other queues, overlapping ticks are serialized, and `SIGINT`/`SIGTERM` wait for the active tick before shutdown. `WORKER_BATCH_LIMIT` bounds each queue lease.

Subscription authorization reconciliation revisits the exact signature already accepted by the API when finalized Solana evidence was pending, not found, or temporarily unavailable. A short `FOR UPDATE ... SKIP LOCKED` transaction records a uniquely identified attempt in indexed subscription events, then commits before the bounded read-only RPC check. A second short transaction applies the outcome only when that attempt is still the latest claim for the exact signature and the subscription remains uncancelled, unrevoked, and `authorization_pending`. A crash leaves the attempt timestamp to become retryable after the bounded cutoff without blocking cancellation; the immutable mutation-command response is never rewritten.

Provider-event replay work is created through the operator/admin authority, but queued replay requests are polled and processed by the recurring scheduler. The scheduler does not invent replay work or bypass the canonical provider handlers.

Notification delivery uses the `notification-deliveries` queue. Browser push remains disabled unless all server-side VAPID settings are present:

- `WEB_PUSH_VAPID_SUBJECT`
- `WEB_PUSH_VAPID_PUBLIC_KEY`
- `WEB_PUSH_VAPID_PRIVATE_KEY`

The public key is also returned through the API push-config route for browser enrollment. The private key stays worker/server-only.
