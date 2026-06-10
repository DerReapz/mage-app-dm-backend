-- Shared battlemap per session: one battlemap row, with an append-only set of
-- ink strokes and a set of tokens. Tokens are bound to a controlling player
-- (player_id) so only that player (or the DM) can move them. Coordinates are
-- stored normalized (0..1) so the same map works on any screen size.
--
-- Storage: background images live in the public storage bucket "battlemaps"
-- under <session_id>/<...>; the URL is stored in battlemaps.background_url.
--
-- Idempotent; safe to re-run.

-- ── battlemaps ────────────────────────────────────────────────────────────
create table if not exists public.battlemaps (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid not null references public.game_sessions(id) on delete cascade,
  name            text not null default 'Battlemap',
  background_url  text,
  -- Native resolution of the background image (used to preserve aspect when
  -- rendering on different screen sizes). Defaults to a 4:3 canvas.
  width           int not null default 1024,
  height          int not null default 768,
  created_by      uuid references public.profiles(id) on delete set null,
  updated_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index if not exists battlemaps_session_idx on public.battlemaps(session_id);

alter table public.battlemaps enable row level security;

drop trigger if exists battlemaps_touch on public.battlemaps;
create trigger battlemaps_touch
  before update on public.battlemaps
  for each row execute function public.touch_updated_at();

drop policy if exists battlemaps_dm_all      on public.battlemaps;
drop policy if exists battlemaps_member_read on public.battlemaps;
drop policy if exists battlemaps_member_ins  on public.battlemaps;
drop policy if exists battlemaps_member_upd  on public.battlemaps;

create policy battlemaps_dm_all on public.battlemaps
  for all to authenticated
  using      (public.is_session_dm(session_id))
  with check (public.is_session_dm(session_id));

create policy battlemaps_member_read on public.battlemaps
  for select to authenticated
  using (public.is_session_member(session_id));

create policy battlemaps_member_ins on public.battlemaps
  for insert to authenticated
  with check (public.is_session_member(session_id));

create policy battlemaps_member_upd on public.battlemaps
  for update to authenticated
  using      (public.is_session_member(session_id))
  with check (public.is_session_member(session_id));

-- ── strokes ──────────────────────────────────────────────────────────────
create table if not exists public.battlemap_strokes (
  id            uuid primary key default gen_random_uuid(),
  battlemap_id  uuid not null references public.battlemaps(id) on delete cascade,
  color         text not null,
  thickness     real not null,
  -- jsonb array of {x, y} points in normalized (0..1) coords.
  points        jsonb not null,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists battlemap_strokes_map_idx
  on public.battlemap_strokes(battlemap_id, created_at);

alter table public.battlemap_strokes enable row level security;

drop policy if exists bm_strokes_dm_all       on public.battlemap_strokes;
drop policy if exists bm_strokes_member_read  on public.battlemap_strokes;
drop policy if exists bm_strokes_member_write on public.battlemap_strokes;
drop policy if exists bm_strokes_self_delete  on public.battlemap_strokes;

create policy bm_strokes_dm_all on public.battlemap_strokes
  for all to authenticated
  using (exists (select 1 from public.battlemaps b
                 where b.id = battlemap_id and public.is_session_dm(b.session_id)))
  with check (exists (select 1 from public.battlemaps b
                      where b.id = battlemap_id and public.is_session_dm(b.session_id)));

create policy bm_strokes_member_read on public.battlemap_strokes
  for select to authenticated
  using (exists (select 1 from public.battlemaps b
                 where b.id = battlemap_id and public.is_session_member(b.session_id)));

create policy bm_strokes_member_write on public.battlemap_strokes
  for insert to authenticated
  with check (exists (select 1 from public.battlemaps b
                      where b.id = battlemap_id and public.is_session_member(b.session_id))
              and created_by = auth.uid());

-- Members can erase their own strokes (DM covered by dm_all).
create policy bm_strokes_self_delete on public.battlemap_strokes
  for delete to authenticated
  using (created_by = auth.uid());

-- ── tokens ──────────────────────────────────────────────────────────────
create table if not exists public.battlemap_tokens (
  id            uuid primary key default gen_random_uuid(),
  battlemap_id  uuid not null references public.battlemaps(id) on delete cascade,
  -- The user who controls this token. Null = unowned/DM-controlled NPC.
  player_id     uuid references public.profiles(id) on delete set null,
  label         text not null default '?',
  color         text not null default '#c8a84b',
  x             real not null default 0.5,
  y             real not null default 0.5,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists battlemap_tokens_map_idx
  on public.battlemap_tokens(battlemap_id);

alter table public.battlemap_tokens enable row level security;

drop trigger if exists battlemap_tokens_touch on public.battlemap_tokens;
create trigger battlemap_tokens_touch
  before update on public.battlemap_tokens
  for each row execute function public.touch_updated_at();

drop policy if exists bm_tokens_dm_all        on public.battlemap_tokens;
drop policy if exists bm_tokens_member_read   on public.battlemap_tokens;
drop policy if exists bm_tokens_member_create on public.battlemap_tokens;
drop policy if exists bm_tokens_self_update   on public.battlemap_tokens;
drop policy if exists bm_tokens_self_delete   on public.battlemap_tokens;

create policy bm_tokens_dm_all on public.battlemap_tokens
  for all to authenticated
  using (exists (select 1 from public.battlemaps b
                 where b.id = battlemap_id and public.is_session_dm(b.session_id)))
  with check (exists (select 1 from public.battlemaps b
                      where b.id = battlemap_id and public.is_session_dm(b.session_id)));

create policy bm_tokens_member_read on public.battlemap_tokens
  for select to authenticated
  using (exists (select 1 from public.battlemaps b
                 where b.id = battlemap_id and public.is_session_member(b.session_id)));

-- A member can create a token they own (player_id = themselves).
create policy bm_tokens_member_create on public.battlemap_tokens
  for insert to authenticated
  with check (
    player_id = auth.uid()
    and exists (select 1 from public.battlemaps b
                where b.id = battlemap_id and public.is_session_member(b.session_id))
  );

-- A player can move/relabel only the token they own (DM covered by dm_all).
create policy bm_tokens_self_update on public.battlemap_tokens
  for update to authenticated
  using      (player_id = auth.uid())
  with check (player_id = auth.uid());

create policy bm_tokens_self_delete on public.battlemap_tokens
  for delete to authenticated
  using (player_id = auth.uid());

-- ── Realtime ────────────────────────────────────────────────────────────
do $$ begin
  alter publication supabase_realtime add table public.battlemaps;
exception when duplicate_object then null;
end $$;
do $$ begin
  alter publication supabase_realtime add table public.battlemap_strokes;
exception when duplicate_object then null;
end $$;
do $$ begin
  alter publication supabase_realtime add table public.battlemap_tokens;
exception when duplicate_object then null;
end $$;

-- ── Storage bucket for background images ────────────────────────────────
insert into storage.buckets (id, name, public)
values ('battlemaps', 'battlemaps', true)
on conflict (id) do nothing;

-- Anyone authenticated can upload / overwrite images to the bucket
-- (write is gated by app logic + bucket name; the URL itself is public so
-- any campaign member can see the image via <img src>).
drop policy if exists "battlemaps insert" on storage.objects;
drop policy if exists "battlemaps update" on storage.objects;
drop policy if exists "battlemaps delete" on storage.objects;
drop policy if exists "battlemaps read"   on storage.objects;

create policy "battlemaps insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'battlemaps');

create policy "battlemaps update" on storage.objects
  for update to authenticated using (bucket_id = 'battlemaps');

create policy "battlemaps delete" on storage.objects
  for delete to authenticated using (bucket_id = 'battlemaps');

-- Public read so the URL works in <img src> without auth headers.
create policy "battlemaps read" on storage.objects
  for select to public using (bucket_id = 'battlemaps');
