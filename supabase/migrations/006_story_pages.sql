-- Chronicle chapters: split the shared story log into multiple named pages
-- (chapters / sections) per game session. Replaces the single-blob story_log
-- for editing; story_log is left in place and its content is migrated into a
-- default "Chapter 1" page so nothing is lost.
--
-- One row per chapter. Editing different chapters never collides, and each
-- chapter syncs independently via realtime.
--
-- Idempotent; safe to re-run.

create table if not exists public.story_pages (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references public.game_sessions(id) on delete cascade,
  title       text not null default 'Untitled',
  content     text not null default '',
  position    int  not null default 0,
  created_by  uuid references public.profiles(id) on delete set null,
  updated_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists story_pages_session_idx on public.story_pages(session_id);

alter table public.story_pages enable row level security;

drop trigger if exists story_pages_touch on public.story_pages;
create trigger story_pages_touch
  before update on public.story_pages
  for each row execute function public.touch_updated_at();

-- DM has full control over their session's chapters.
drop policy if exists story_pages_dm_all on public.story_pages;
create policy story_pages_dm_all on public.story_pages
  for all to authenticated
  using      (public.is_session_dm(session_id))
  with check (public.is_session_dm(session_id));

-- Any session member can read, create, and edit chapters.
drop policy if exists story_pages_member_read   on public.story_pages;
drop policy if exists story_pages_member_insert on public.story_pages;
drop policy if exists story_pages_member_update on public.story_pages;
drop policy if exists story_pages_member_delete on public.story_pages;

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

-- Members may delete only chapters they created; the DM can delete any
-- (covered by story_pages_dm_all).
create policy story_pages_member_delete on public.story_pages
  for delete to authenticated
  using (created_by = auth.uid());

-- Realtime broadcast.
do $$ begin
  alter publication supabase_realtime add table public.story_pages;
exception when duplicate_object then null;
end $$;

-- Migrate existing single-blob story_log content into a default chapter so
-- chronicles written before this change keep their text.
insert into public.story_pages (session_id, title, content, position, created_by, updated_by, created_at, updated_at)
select sl.session_id, 'Chapter 1', sl.content, 0, gs.dm_id, sl.updated_by, sl.updated_at, sl.updated_at
from public.story_log sl
join public.game_sessions gs on gs.id = sl.session_id
where coalesce(sl.content, '') <> ''
  and not exists (select 1 from public.story_pages sp where sp.session_id = sl.session_id);
