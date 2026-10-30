-- =====================================================================
-- Buffalo Machines Staff Hub: merge duplicate accessories (run once)
-- Paste this whole file into Supabase > SQL Editor > New query > Run.
-- Safe to run more than once. On its own it changes nothing; it adds a tool
-- the FOUNDER can use from the Machines page.
--
-- merge_accessories(keep, merge, name): turns several accessories that are
-- really the same part (one per machine) into ONE accessory that fits all
-- of those machines. Stock (machines) and waiting-list customers move to the
-- kept accessory; its price is kept (or the first price found); the others
-- are deleted. All in one step, so nothing is half-done.
-- =====================================================================

create or replace function public.merge_accessories(p_keep uuid, p_merge uuid[], p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_all uuid[] := p_merge || p_keep;
begin
  if not public.is_founder() then
    raise exception 'Only the founder can merge accessories.';
  end if;
  if p_keep = any (p_merge) or coalesce(array_length(p_merge, 1), 0) = 0 then
    raise exception 'Choose at least one other accessory to merge in.';
  end if;
  if exists (select 1 from public.models where id = any (v_all) and kind <> 'accessory') then
    raise exception 'Only accessories can be merged.';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'The merged accessory needs a name.';
  end if;

  -- 1. The kept accessory fits every machine, has every size, and keeps a price.
  update public.models k set
    fits_models = (select array(select distinct unnest(m.fits_models) from public.models m where m.id = any (v_all))),
    sizes       = (select array(select distinct unnest(m.sizes) from public.models m where m.id = any (v_all))),
    price       = coalesce(k.price, (select m.price from public.models m where m.id = any (p_merge) and m.price is not null limit 1)),
    size_prices = (select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) from (
                     select distinct on (e.key) e.key, e.value
                       from public.models m, jsonb_each(m.size_prices) e
                      where m.id = any (v_all)
                      order by e.key, (m.id = p_keep) desc) s)
  where k.id = p_keep;

  -- 2. Move stock and waiting customers across, then remove the duplicates.
  update public.machines set model_id = p_keep where model_id = any (p_merge);
  update public.waitlist set model_id = p_keep where model_id = any (p_merge);
  delete from public.models where id = any (p_merge);

  -- 3. Name it after all the machines it fits.
  update public.models set model_number = trim(p_name) where id = p_keep;
end $$;

revoke all on function public.merge_accessories(uuid, uuid[], text) from public, anon;
grant execute on function public.merge_accessories(uuid, uuid[], text) to authenticated;
