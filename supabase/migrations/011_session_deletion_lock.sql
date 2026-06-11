-- DM-only campaign deletion lock: a DM can lock a chronicle so DELETE on
-- public.game_sessions is refused server-side. Mirrors the same pattern as
-- 009_battlemap_background_lock.sql.
--
-- The existing sessions_dm_all RLS policy already restricts UPDATE on
-- game_sessions to the DM (dm_id = auth.uid()), so toggling deletion_locked
-- is DM-only without an extra trigger. The BEFORE DELETE trigger below
-- guarantees that a hand-crafted API call from anyone — including the DM —
-- can't bypass the lock by issuing a direct DELETE.
--
-- Idempotent; safe to re-run.

alter table public.game_sessions
  add column if not exists deletion_locked boolean not null default false;

create or replace function public.game_sessions_enforce_deletion_lock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.deletion_locked then
    raise exception 'chronicle is locked — unlock before deleting'
      using errcode = 'P0001';
  end if;
  return old;
end;
$$;

drop trigger if exists game_sessions_deletion_lock on public.game_sessions;
create trigger game_sessions_deletion_lock
  before delete on public.game_sessions
  for each row execute function public.game_sessions_enforce_deletion_lock();
