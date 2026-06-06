# apps/worker

Worker process for provider webhooks, reconciliation, moderation, media status refreshes, and retries.

Notification delivery uses the `notification-deliveries` queue. Browser push remains disabled unless all server-side VAPID settings are present:

- `WEB_PUSH_VAPID_SUBJECT`
- `WEB_PUSH_VAPID_PUBLIC_KEY`
- `WEB_PUSH_VAPID_PRIVATE_KEY`

The public key is also returned through the API push-config route for browser enrollment. The private key stays worker/server-only.
