create index worker_queue_recovery_requests_requested_by_user_idx
  on worker_queue_recovery_requests (requested_by_user_id)
  where requested_by_user_id is not null;
