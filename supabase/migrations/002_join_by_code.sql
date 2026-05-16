-- Lets a player join a session using only the invite code.
-- Pre-membership the player cannot SELECT game_sessions (RLS blocks them),
-- so we use a SECURITY DEFINER function that looks up the row and inserts
-- the membership atomically. Returns the joined session.
--
-- Run this on an existing project that already has schema.sql applied.
-- Idempotent: safe to re-run.

create or replace function public.join_session_by_code(p_code text)
returns public.game_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.game_sessions;
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  select * into s
    from public.game_sessions
    where invite_code = upper(p_code)
    limit 1;

  if not found then
    raise exception 'invite code not found';
  end if;

  -- A DM joining their own session is a no-op.
  if s.dm_id = uid then
    return s;
  end if;

  insert into public.session_members (session_id, player_id)
    values (s.id, uid)
    on conflict (session_id, player_id) do nothing;

  return s;
end;
$$;

revoke all on function public.join_session_by_code(text) from public;
grant execute on function public.join_session_by_code(text) to authenticated;
