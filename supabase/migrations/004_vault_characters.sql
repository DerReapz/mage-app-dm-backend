-- 004_vault_characters.sql
-- Per-user character vault: stores characters tied to a player's account,
-- independent of any DM session. This lets the player app persist sheets
-- server-side even when the character is not linked to a chronicle.
-- The local_id column mirrors the client-side localStorage key so the app
-- can upsert idempotently and restore characters on any device after login.

create table if not exists public.vault_characters (
  id          uuid        primary key default gen_random_uuid(),
  player_id   uuid        not null references public.profiles(id) on delete cascade,
  local_id    text        not null,
  name        text        not null default 'New Mage',
  sheet       jsonb       not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (player_id, local_id)
);

create index if not exists vault_characters_player_idx
  on public.vault_characters(player_id);

-- Reuse the existing touch_updated_at trigger function.
create trigger vault_characters_touch
  before update on public.vault_characters
  for each row execute function public.touch_updated_at();

-- RLS: players own their own vault rows.
alter table public.vault_characters enable row level security;

create policy vault_characters_owner_all on public.vault_characters
  for all to authenticated
  using      (player_id = auth.uid())
  with check (player_id = auth.uid());

-- Include in Realtime so the app can react to cross-device changes.
alter publication supabase_realtime add table public.vault_characters;
