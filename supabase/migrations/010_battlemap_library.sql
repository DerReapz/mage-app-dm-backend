-- Battlemap image library: the DM keeps a per-session collection of map
-- images they can toggle between as the active battlemap background. This
-- is a DM-only persistent storage; players see only whatever the DM has
-- currently set as the battlemap background.
--
-- Idempotent; safe to re-run.

create table if not exists public.battlemap_library (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references public.game_sessions(id) on delete cascade,
  name        text not null default 'Untitled map',
  url         text not null,
  width       int  not null default 1024,
  height      int  not null default 768,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists battlemap_library_session_idx
  on public.battlemap_library(session_id, created_at);

alter table public.battlemap_library enable row level security;

-- DM-only: only the DM of the session sees, adds, renames, or removes
-- entries. Players never touch this table; the active background is still
-- the battlemaps.background_url field which they already read.
drop policy if exists battlemap_library_dm_all on public.battlemap_library;
create policy battlemap_library_dm_all on public.battlemap_library
  for all to authenticated
  using      (public.is_session_dm(session_id))
  with check (public.is_session_dm(session_id));

-- Realtime so a DM on two devices sees the library converge live.
do $$ begin
  alter publication supabase_realtime add table public.battlemap_library;
exception when duplicate_object then null;
end $$;
