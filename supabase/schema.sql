-- Mage DM Dashboard — Supabase schema
-- Paste this into Supabase SQL editor (or run via supabase db push).
-- Assumes auth.users already exists (Supabase default).

create extension if not exists "pgcrypto";

-- 1. Profiles: one row per auth user, with a display handle.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  handle text not null,
  created_at timestamptz not null default now()
);

-- 2. Game sessions ("chronicles"): owned by a DM.
create table public.game_sessions (
  id uuid primary key default gen_random_uuid(),
  dm_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  invite_code text not null unique,
  created_at timestamptz not null default now()
);

create index game_sessions_dm_id_idx on public.game_sessions(dm_id);

-- 3. Membership: which players belong to which session.
create table public.session_members (
  session_id uuid not null references public.game_sessions(id) on delete cascade,
  player_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (session_id, player_id)
);

-- 4. Characters: one row per (player, session). Sheet is the raw JSON
--    blob in the same shape the player app already uses (key "mage_chars" value).
create table public.characters (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.game_sessions(id) on delete cascade,
  player_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  sheet jsonb not null,
  updated_at timestamptz not null default now(),
  unique (session_id, player_id)
);

create index characters_session_idx on public.characters(session_id);

-- Keep updated_at fresh on writes.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger characters_touch
  before update on public.characters
  for each row execute function public.touch_updated_at();

-- ============================================================
-- Row Level Security
-- ============================================================
alter table public.profiles        enable row level security;
alter table public.game_sessions   enable row level security;
alter table public.session_members enable row level security;
alter table public.characters      enable row level security;

-- Profiles: anyone authenticated can read profiles they share a session with;
-- users can update only their own row.
create policy profiles_self_read on public.profiles
  for select to authenticated using (true);
create policy profiles_self_write on public.profiles
  for update to authenticated using (id = auth.uid());
create policy profiles_self_insert on public.profiles
  for insert to authenticated with check (id = auth.uid());

-- Game sessions:
--   DM can do anything with their own sessions.
--   Members can read sessions they belong to.
create policy sessions_dm_all on public.game_sessions
  for all to authenticated
  using (dm_id = auth.uid())
  with check (dm_id = auth.uid());

create policy sessions_member_read on public.game_sessions
  for select to authenticated using (
    exists (
      select 1 from public.session_members m
      where m.session_id = game_sessions.id and m.player_id = auth.uid()
    )
  );

-- Session members:
--   DM of the session can manage membership.
--   Members can see who else is in their session.
--   A player can insert themselves (join) and delete themselves (leave).
create policy members_dm_all on public.session_members
  for all to authenticated
  using (
    exists (select 1 from public.game_sessions s
            where s.id = session_members.session_id and s.dm_id = auth.uid())
  )
  with check (
    exists (select 1 from public.game_sessions s
            where s.id = session_members.session_id and s.dm_id = auth.uid())
  );

create policy members_read on public.session_members
  for select to authenticated using (
    player_id = auth.uid()
    or exists (select 1 from public.session_members m
               where m.session_id = session_members.session_id and m.player_id = auth.uid())
  );

create policy members_self_join on public.session_members
  for insert to authenticated with check (player_id = auth.uid());

create policy members_self_leave on public.session_members
  for delete to authenticated using (player_id = auth.uid());

-- Characters:
--   Player can read+write their own character row.
--   DM of the session can read all character rows in that session.
create policy characters_player_rw on public.characters
  for all to authenticated
  using (player_id = auth.uid())
  with check (player_id = auth.uid());

create policy characters_dm_read on public.characters
  for select to authenticated using (
    exists (select 1 from public.game_sessions s
            where s.id = characters.session_id and s.dm_id = auth.uid())
  );

-- ============================================================
-- Helper: generate a 6-char invite code on session insert if absent.
-- ============================================================
create or replace function public.gen_invite_code()
returns trigger language plpgsql as $$
declare
  candidate text;
  attempts int := 0;
begin
  if new.invite_code is not null and length(new.invite_code) > 0 then
    return new;
  end if;
  loop
    candidate := upper(substr(encode(gen_random_bytes(6), 'base64'), 1, 6));
    candidate := regexp_replace(candidate, '[^A-Z0-9]', '', 'g');
    exit when length(candidate) = 6 and not exists (
      select 1 from public.game_sessions where invite_code = candidate
    );
    attempts := attempts + 1;
    if attempts > 20 then
      raise exception 'could not generate unique invite_code';
    end if;
  end loop;
  new.invite_code := candidate;
  return new;
end $$;

create trigger game_sessions_invite_code
  before insert on public.game_sessions
  for each row execute function public.gen_invite_code();

-- ============================================================
-- Realtime
-- ============================================================
alter publication supabase_realtime add table public.characters;
alter publication supabase_realtime add table public.session_members;
