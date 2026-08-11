drop policy if exists worker_queue_recovery_requests_browser_deny
  on worker_queue_recovery_requests;

grant select, insert, update, delete on table worker_queue_recovery_requests
  to anon, authenticated;
