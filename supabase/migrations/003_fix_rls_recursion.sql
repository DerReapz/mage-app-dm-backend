-- Fix infinite recursion in session_members / game_sessions RLS.
--
-- The original policies cross-referenced each other:
--   - session_members SELECT policy queried session_members in a subquery
--   - game_sessions SELECT-for-members queried session_members,
--     and session_members DM policy queried game_sessions.
-- Either alone, or together, Postgres trips the recursion detector when
-- evaluating policies for any query against these tables.
--
-- Fix: use two SECURITY DEFINER helper functions that read the underlying
-- tables directly (bypassing RLS), then have the policies call them.
-- That breaks the cycle.
--
-- Run on an existing project that already has schema.sql applied.

create or replace function public.is_session_dm(p_session uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from game_sessions
    where id = p_session and dm_id = auth.uid()
  );
$$;

create or replace function public.is_session_member(p_session uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from session_members
    where session_id = p_session and player_id = auth.uid()
  );
$$;

revoke all on function public.is_session_dm(uuid)     from public;
revoke all on function public.is_session_member(uuid) from public;
grant  execute on function public.is_session_dm(uuid)     to authenticated;
grant  execute on function public.is_session_member(uuid) to authenticated;

-- Drop the recursive policies, then recreate using the helpers.
drop policy if exists sessions_dm_all      on public.game_sessions;
drop policy if exists sessions_member_read on public.game_sessions;
drop policy if exists members_dm_all       on public.session_members;
drop policy if exists members_read         on public.session_members;
drop policy if exists characters_dm_read   on public.characters;

create policy sessions_dm_all on public.game_sessions
  for all to authenticated
  using      (dm_id = auth.uid())
  with check (dm_id = auth.uid());

create policy sessions_member_read on public.game_sessions
  for select to authenticated
  using (public.is_session_member(id));

create policy members_dm_all on public.session_members
  for all to authenticated
  using      (public.is_session_dm(session_id))
  with check (public.is_session_dm(session_id));

-- Members can see their own row only. The DM policy already covers
-- the DM seeing every row in their session, so we don't need a
-- "see fellow members" policy — and adding one re-introduces the cycle.
create policy members_self_read on public.session_members
  for select to authenticated
  using (player_id = auth.uid());

create policy characters_dm_read on public.characters
  for select to authenticated
  using (public.is_session_dm(session_id));
