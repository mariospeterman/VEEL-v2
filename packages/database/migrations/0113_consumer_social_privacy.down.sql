-- Roll back Convergence 06 only before retaining consumer-social traffic.

do $$
begin
  if exists (select 1 from comment_reactions)
     or exists (select 1 from comment_mentions)
     or exists (select 1 from user_mutes)
     or exists (select 1 from comments where parent_comment_id is not null)
     or exists (select 1 from engagement_action_receipts where action in (
       'comment.like', 'user.unblock', 'user.mute', 'user.unmute'
     ))
     or exists (select 1 from data_requests where idempotency_key not like 'legacy:%') then
    raise exception using
      errcode = 'object_not_in_prerequisite_state',
      message = '0113 rollback requires retained consumer-social traffic to be migrated first';
  end if;
end;
$$;

drop trigger if exists comments_parent_guard on comments;
drop function if exists private.enforce_comment_parent();

alter table data_requests
  drop constraint if exists data_requests_idempotency_key_length,
  drop constraint if exists data_requests_requester_idempotency_unique,
  drop column if exists idempotency_key;

drop table if exists user_mutes;
drop table if exists comment_mentions;
drop table if exists comment_reactions;

-- Blocks predate this slice. Their new receipt projection can be discarded on
-- downgrade because the canonical blocks rows and their original replay keys remain.
delete from engagement_action_receipts where action = 'user.block';

alter table engagement_action_receipts
  drop constraint engagement_action_receipts_action_check,
  add constraint engagement_action_receipts_action_check check (action in (
    'content.like', 'content.save'
  ));
