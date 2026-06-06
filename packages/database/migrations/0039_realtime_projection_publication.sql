-- Supabase Realtime publication for user-owned projections only.
-- Business mutations still go through Fastify; RLS controls direct change visibility.

do $$
begin
  alter publication supabase_realtime add table notifications;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table messages;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table conversation_members;
exception
  when duplicate_object then null;
end $$;
