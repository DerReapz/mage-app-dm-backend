-- Per-player character vault: every signed-in player has all their characters
-- automatically pushed to Supabase and pulled back on a fresh device.
--
-- Primary key (player_id, char_id) — char_id is the same opaque local id
-- the client uses in localStorage's mage_chars map, kept stable across devices
-- so re-syncing a character doesn't create a duplicate row.
--
-- Soft delete: a row stays around with deleted_at set so peer devices learn
-- about the deletion when they next pull. last-write-wins on client_updated_at
-- means a peer that edited after the delete wins and the row reactivates.
--
-- Idempotent; safe to re-run.

create table if not exists public.player_characters (
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

create index if not exists player_characters_player_idx
  on public.player_characters(player_id);

alter table public.player_characters enable row level security;

drop trigger if exists player_characters_touch on public.player_characters;
create trigger player_characters_touch
  before update on public.player_characters
  for each row execute function public.touch_updated_at();

-- Only the owning player can read or write their vault rows. No DM access —
-- this vault is private; sharing to a DM still goes through the existing
-- session-bound public.characters table.
drop policy if exists vault_self_all on public.player_characters;
create policy vault_self_all on public.player_characters
  for all to authenticated
  using      (player_id = auth.uid())
  with check (player_id = auth.uid());

do $$ begin
  alter publication supabase_realtime add table public.player_characters;
exception when duplicate_object then null;
end $$;
