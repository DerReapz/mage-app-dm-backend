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

-- Membership helpers (SECURITY DEFINER) break the cross-table RLS cycle
-- between session_members and game_sessions. Policies below call these
-- instead of doing the EXISTS subquery inline.
create or replace function public.is_session_dm(p_session uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from game_sessions
    where id = p_session and dm_id = auth.uid()
  );
$$;

create or replace function public.is_session_member(p_session uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from session_members
    where session_id = p_session and player_id = auth.uid()
  );
$$;

revoke all on function public.is_session_dm(uuid)     from public;
revoke all on function public.is_session_member(uuid) from public;
grant  execute on function public.is_session_dm(uuid)     to authenticated;
grant  execute on function public.is_session_member(uuid) to authenticated;

-- Game sessions:
--   DM can do anything with their own sessions.
--   Members can read sessions they belong to.
create policy sessions_dm_all on public.game_sessions
  for all to authenticated
  using (dm_id = auth.uid())
  with check (dm_id = auth.uid());

create policy sessions_member_read on public.game_sessions
  for select to authenticated using (public.is_session_member(id));

-- Session members:
--   DM of the session can manage membership.
--   A player can read only their own row (the DM still sees every row
--    in their session via members_dm_all).
--   A player can insert themselves (join) and delete themselves (leave).
create policy members_dm_all on public.session_members
  for all to authenticated
  using      (public.is_session_dm(session_id))
  with check (public.is_session_dm(session_id));

create policy members_self_read on public.session_members
  for select to authenticated using (player_id = auth.uid());

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
  for select to authenticated using (public.is_session_dm(session_id));

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
-- Shared story log: one collaborative text blob per session,
-- editable by the DM and every member. Last-write-wins.
-- ============================================================
create table public.story_log (
  session_id  uuid primary key references public.game_sessions(id) on delete cascade,
  content     text not null default '',
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles(id) on delete set null
);

alter table public.story_log enable row level security;

create trigger story_log_touch
  before update on public.story_log
  for each row execute function public.touch_updated_at();

create policy story_dm_all on public.story_log
  for all to authenticated
  using      (public.is_session_dm(session_id))
  with check (public.is_session_dm(session_id));

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

-- ============================================================
-- Chronicle chapters: multiple named story pages per session. The DM
-- and every member can read/create/edit; members may delete only their
-- own chapters, the DM may delete any.
-- ============================================================
create table public.story_pages (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references public.game_sessions(id) on delete cascade,
  title       text not null default 'Untitled',
  content     text not null default '',
  position    int  not null default 0,
  created_by  uuid references public.profiles(id) on delete set null,
  updated_by  uuid references public.profiles(id) on delete set null,
  deleted_at  timestamptz,
  deleted_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index story_pages_session_idx on public.story_pages(session_id);
create index story_pages_session_deleted_idx on public.story_pages(session_id, deleted_at);

alter table public.story_pages enable row level security;

create trigger story_pages_touch
  before update on public.story_pages
  for each row execute function public.touch_updated_at();

create policy story_pages_dm_all on public.story_pages
  for all to authenticated
  using      (public.is_session_dm(session_id))
  with check (public.is_session_dm(session_id));

create policy story_pages_member_read on public.story_pages
  for select to authenticated
  using (public.is_session_member(session_id));

create policy story_pages_member_insert on public.story_pages
  for insert to authenticated
  with check (public.is_session_member(session_id));

create policy story_pages_member_update on public.story_pages
  for update to authenticated
  using      (public.is_session_member(session_id))
  with check (public.is_session_member(session_id));

-- Permanent purge from trash is gated to the DM via story_pages_dm_all.
-- Members soft-delete via an UPDATE that sets deleted_at, which the
-- story_pages_member_update policy already covers.

-- ============================================================
-- Per-player vault: every signed-in player's characters auto-sync to
-- this private table, keyed by (player_id, char_id) so re-syncing
-- doesn't duplicate. Soft-deleted rows keep peer devices in sync.
-- ============================================================
create table public.player_characters (
  player_id          uuid not null references public.profiles(id) on delete cascade,
  char_id            text not null,
  name               text not null,
  sheet              jsonb not null,
  client_updated_at  timestamptz not null,
  deleted_at         timestamptz,
  updated_at         timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  primary key (player_id, char_id)
);

create index player_characters_player_idx on public.player_characters(player_id);

alter table public.player_characters enable row level security;

create trigger player_characters_touch
  before update on public.player_characters
  for each row execute function public.touch_updated_at();

create policy vault_self_all on public.player_characters
  for all to authenticated
  using      (player_id = auth.uid())
  with check (player_id = auth.uid());

-- ============================================================
-- Realtime
-- ============================================================
alter publication supabase_realtime add table public.characters;
alter publication supabase_realtime add table public.session_members;
alter publication supabase_realtime add table public.story_log;
alter publication supabase_realtime add table public.story_pages;
alter publication supabase_realtime add table public.player_characters;

-- ============================================================
-- Join-by-invite-code RPC (see migrations/002_join_by_code.sql for rationale)
-- ============================================================
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

-- ============================================================
-- Shared battlemap per session
-- ============================================================
create table public.battlemaps (
  id                uuid primary key default gen_random_uuid(),
  session_id        uuid not null references public.game_sessions(id) on delete cascade,
  name              text not null default 'Battlemap',
  background_url    text,
  background_locked boolean not null default false,
  width             int not null default 1024,
  height            int not null default 768,
  created_by        uuid references public.profiles(id) on delete set null,
  updated_by        uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create unique index battlemaps_session_idx on public.battlemaps(session_id);
alter table public.battlemaps enable row level security;
create trigger battlemaps_touch before update on public.battlemaps
  for each row execute function public.touch_updated_at();

-- Enforce DM-only background lock toggle, and DM-only changes to the image
-- fields while the lock is on. Without this, a hand-crafted API call from a
-- session member could bypass the disabled UI buttons.
create or replace function public.battlemaps_enforce_bg_lock()
returns trigger language plpgsql security definer set search_path = public as $$
declare is_dm boolean;
begin
  is_dm := public.is_session_dm(old.session_id);
  if new.background_locked is distinct from old.background_locked and not is_dm then
    raise exception 'battlemap background lock is DM-only';
  end if;
  if old.background_locked
     and not is_dm
     and (new.background_url is distinct from old.background_url
       or new.width          is distinct from old.width
       or new.height         is distinct from old.height) then
    raise exception 'battlemap background is locked';
  end if;
  return new;
end $$;
create trigger battlemaps_bg_lock before update on public.battlemaps
  for each row execute function public.battlemaps_enforce_bg_lock();
create policy battlemaps_dm_all on public.battlemaps for all to authenticated
  using (public.is_session_dm(session_id)) with check (public.is_session_dm(session_id));
create policy battlemaps_member_read on public.battlemaps for select to authenticated
  using (public.is_session_member(session_id));
create policy battlemaps_member_ins on public.battlemaps for insert to authenticated
  with check (public.is_session_member(session_id));
create policy battlemaps_member_upd on public.battlemaps for update to authenticated
  using (public.is_session_member(session_id)) with check (public.is_session_member(session_id));

create table public.battlemap_strokes (
  id            uuid primary key default gen_random_uuid(),
  battlemap_id  uuid not null references public.battlemaps(id) on delete cascade,
  color         text not null,
  thickness     real not null,
  points        jsonb not null,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index battlemap_strokes_map_idx on public.battlemap_strokes(battlemap_id, created_at);
alter table public.battlemap_strokes enable row level security;
create policy bm_strokes_dm_all on public.battlemap_strokes for all to authenticated
  using (exists (select 1 from public.battlemaps b where b.id = battlemap_id and public.is_session_dm(b.session_id)))
  with check (exists (select 1 from public.battlemaps b where b.id = battlemap_id and public.is_session_dm(b.session_id)));
create policy bm_strokes_member_read on public.battlemap_strokes for select to authenticated
  using (exists (select 1 from public.battlemaps b where b.id = battlemap_id and public.is_session_member(b.session_id)));
create policy bm_strokes_member_write on public.battlemap_strokes for insert to authenticated
  with check (exists (select 1 from public.battlemaps b where b.id = battlemap_id and public.is_session_member(b.session_id))
              and created_by = auth.uid());
create policy bm_strokes_self_delete on public.battlemap_strokes for delete to authenticated
  using (created_by = auth.uid());

create table public.battlemap_tokens (
  id            uuid primary key default gen_random_uuid(),
  battlemap_id  uuid not null references public.battlemaps(id) on delete cascade,
  player_id     uuid references public.profiles(id) on delete set null,
  label         text not null default '?',
  color         text not null default '#c8a84b',
  x             real not null default 0.5,
  y             real not null default 0.5,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index battlemap_tokens_map_idx on public.battlemap_tokens(battlemap_id);
alter table public.battlemap_tokens enable row level security;
create trigger battlemap_tokens_touch before update on public.battlemap_tokens
  for each row execute function public.touch_updated_at();
create policy bm_tokens_dm_all on public.battlemap_tokens for all to authenticated
  using (exists (select 1 from public.battlemaps b where b.id = battlemap_id and public.is_session_dm(b.session_id)))
  with check (exists (select 1 from public.battlemaps b where b.id = battlemap_id and public.is_session_dm(b.session_id)));
create policy bm_tokens_member_read on public.battlemap_tokens for select to authenticated
  using (exists (select 1 from public.battlemaps b where b.id = battlemap_id and public.is_session_member(b.session_id)));
create policy bm_tokens_member_create on public.battlemap_tokens for insert to authenticated
  with check (player_id = auth.uid()
              and exists (select 1 from public.battlemaps b where b.id = battlemap_id and public.is_session_member(b.session_id)));
create policy bm_tokens_self_update on public.battlemap_tokens for update to authenticated
  using (player_id = auth.uid()) with check (player_id = auth.uid());
create policy bm_tokens_self_delete on public.battlemap_tokens for delete to authenticated
  using (player_id = auth.uid());

alter publication supabase_realtime add table public.battlemaps;
alter publication supabase_realtime add table public.battlemap_strokes;
alter publication supabase_realtime add table public.battlemap_tokens;

-- Public bucket for battlemap background images.
insert into storage.buckets (id, name, public) values ('battlemaps', 'battlemaps', true)
  on conflict (id) do nothing;
create policy "battlemaps insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'battlemaps');
create policy "battlemaps update" on storage.objects
  for update to authenticated using (bucket_id = 'battlemaps');
create policy "battlemaps delete" on storage.objects
  for delete to authenticated using (bucket_id = 'battlemaps');
create policy "battlemaps read" on storage.objects
  for select to public using (bucket_id = 'battlemaps');
