-- Background lock: a DM can lock the battlemap background image so other
-- session members can't replace or remove it. The lock itself can only be
-- toggled by the DM. Server-side trigger enforces both rules so a hand-crafted
-- API call from a player can't bypass the UI gate.
--
-- Idempotent; safe to re-run.

alter table public.battlemaps
  add column if not exists background_locked boolean not null default false;

create or replace function public.battlemaps_enforce_bg_lock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  is_dm boolean;
begin
  is_dm := public.is_session_dm(old.session_id);

  -- Only the DM may flip the lock.
  if new.background_locked is distinct from old.background_locked and not is_dm then
    raise exception 'battlemap background lock is DM-only';
  end if;

  -- When the background is locked, only the DM may change the image fields.
  if old.background_locked
     and not is_dm
     and (new.background_url is distinct from old.background_url
       or new.width          is distinct from old.width
       or new.height         is distinct from old.height) then
    raise exception 'battlemap background is locked';
  end if;

  return new;
end;
$$;

drop trigger if exists battlemaps_bg_lock on public.battlemaps;
create trigger battlemaps_bg_lock
  before update on public.battlemaps
  for each row execute function public.battlemaps_enforce_bg_lock();
