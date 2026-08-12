-- Worker recovery reasons and idempotency keys are server/admin command data.
-- Browser roles have no direct table access; the API exposes no raw projection.

revoke all on table worker_queue_recovery_requests from anon, authenticated;

create policy worker_queue_recovery_requests_browser_deny
  on worker_queue_recovery_requests
  for all
  to anon, authenticated
  using (false)
  with check (false);
