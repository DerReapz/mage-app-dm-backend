-- Shared, collaborative story log: one text blob per game_session, edited
-- live by the DM and every member of that session.
--
-- Conflict model: last-write-wins on the whole row. Realtime broadcasts every
-- update; clients debounce writes and rebase incoming remote state when their
-- editor isn't focused. Good enough for collaborative narrative log writing.
--
-- Idempotent; safe to re-run.

create table if not exists public.story_log (
  session_id  uuid primary key references public.game_sessions(id) on delete cascade,
  content     text not null default '',
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles(id) on delete set null
);

alter table public.story_log enable row level security;

-- Keep updated_at fresh on writes (reuse the helper defined in schema.sql).
drop trigger if exists story_log_touch on public.story_log;
create trigger story_log_touch
  before update on public.story_log
  for each row execute function public.touch_updated_at();

-- DM has full control over their session's log.
drop policy if exists story_dm_all on public.story_log;
create policy story_dm_all on public.story_log
  for all to authenticated
  using      (public.is_session_dm(session_id))
  with check (public.is_session_dm(session_id));

-- Any session member can read, create, and update the row for sessions they
-- belong to. Members cannot delete; only the DM (via story_dm_all) or a
-- cascade from game_sessions removes it.
drop policy if exists story_member_read   on public.story_log;
drop policy if exists story_member_insert on public.story_log;
drop policy if exists story_member_update on public.story_log;

create policy story_member_read on public.story_log
  for select to authenticated
  using (public.is_session_member(session_id));

create policy story_member_insert on public.story_log
  for insert to authenticated
  with check (public.is_session_member(session_id));

create policy story_member_update on public.story_log
  for update to authenticated
  using      (public.is_session_member(session_id))
  with check (public.is_session_member(session_id));

-- Realtime broadcast.
do $$ begin
  alter publication supabase_realtime add table public.story_log;
exception when duplicate_object then null;
end $$;
