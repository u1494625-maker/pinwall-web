-- NOT executed automatically. Review, then run in your Supabase project's SQL
-- editor once you're ready — AFTER post_drafts.sql (this depends on the
-- post_drafts/draft_media tables and the unique(draft_id, position)
-- deferrable constraint it creates). Written to be safely re-runnable.
--
-- Phase 4A: order/position reconciliation. Local reordering (drag) never
-- writes to Supabase on every move — only at an explicit save/sync point
-- (the debounced media-order autosave, or Save Draft's final flush) does the
-- client send the full, final, contiguous order for every already-persisted
-- item in this draft. Doing that as N separate client-side UPDATE calls
-- risks a transient unique(draft_id, position) violation the moment two
-- items' target positions cross paths mid-sequence (each REST call is its
-- own transaction, so the deferred constraint can't help across them). One
-- RPC call is one transaction, so the constraint's actual "deferred until
-- commit" behavior applies: every row can move through an intermediate,
-- possibly-colliding position mid-statement, and only the FINAL, unique
-- state at commit is what's checked.
create or replace function public.reorder_draft_media(p_draft_id uuid, p_ordered_ids bigint[])
returns void
language plpgsql
security invoker
as $$
declare
  owner_id uuid;
  media_count integer;
  matching_count integer;
begin
  select user_id into owner_id from public.post_drafts where id = p_draft_id;
  if owner_id is null or owner_id <> auth.uid() then
    raise exception 'Draft not found or not owned by caller';
  end if;

  select count(*) into media_count from public.draft_media where draft_id = p_draft_id;

  -- Every id in the input must be distinct AND belong to this exact draft —
  -- this single check catches a wrong count, a duplicate id, and a foreign
  -- id all at once (a foreign or duplicate id can't appear in the distinct
  -- join-matched count, so any of those makes matching_count come up short).
  select count(*) into matching_count
    from (select distinct id from unnest(p_ordered_ids) as id) u
    join public.draft_media dm on dm.id = u.id and dm.draft_id = p_draft_id;

  if media_count <> coalesce(array_length(p_ordered_ids, 1), 0) or media_count <> matching_count then
    raise exception 'Reorder must include every media item in this draft exactly once';
  end if;

  update public.draft_media dm
     set position = ord.new_position
    from (
      select id, ord - 1 as new_position
      from unnest(p_ordered_ids) with ordinality as t(id, ord)
    ) ord
   where dm.id = ord.id and dm.draft_id = p_draft_id;
end;
$$;

grant execute on function public.reorder_draft_media(uuid, bigint[]) to authenticated;
