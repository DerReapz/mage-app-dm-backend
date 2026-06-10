-- Soft delete for chronicle chapters: pressing ✕ DELETE on a chapter now
-- moves it to a trash list (deleted_at set) instead of removing the row.
-- The Trash UI surfaces the deleted chapters so they can be restored. Only
-- the DM may permanently purge a chapter (DELETE row).
--
-- Idempotent; safe to re-run.

alter table public.story_pages
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles(id) on delete set null;

create index if not exists story_pages_session_deleted_idx
  on public.story_pages(session_id, deleted_at);

-- Members no longer hard-delete chapters; soft delete is just an UPDATE that
-- the existing member_update policy already allows. Hard purge stays gated to
-- the DM via the existing story_pages_dm_all policy.
drop policy if exists story_pages_member_delete on public.story_pages;
