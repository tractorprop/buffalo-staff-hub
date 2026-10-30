-- =====================================================================
-- Buffalo Machines Staff Hub: reference number on stock entries (run once)
-- Paste this whole file into Supabase > SQL Editor > New query > Run.
--
-- What it does:
--   * Adds one column, machines.stock_reference, holding the reference
--     number typed on the last stock entry for that machine.
--   * Replaces the stock entry function with one that REQUIRES a reference
--     number and saves it. The old version (without a reference) is removed,
--     so nobody can record a stock entry without one.
--   The activity log already records every change, so the history on the
--   Stock entry page can show which reference each entry was made under.
--
-- What it does NOT do:
--   No policies are changed. Staff still cannot edit machines directly.
--
-- Safe to run more than once.
-- =====================================================================

alter table public.machines add column if not exists stock_reference text;

drop function if exists public.record_stock_movement(uuid, text, int);

create or replace function public.record_stock_movement(p_model_id uuid, p_size text, p_qty int, p_reference text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sizes text[];
  v_model text;
  v_avail int;
  v_done  int := 0;
begin
  if auth.uid() is null then
    raise exception 'Please sign in.';
  end if;
  p_reference := nullif(trim(p_reference), '');
  if p_reference is null then
    raise exception 'Please enter a reference number.';
  end if;
  if length(p_reference) > 60 then
    raise exception 'The reference number is too long (60 characters at most).';
  end if;
  if p_qty is null or p_qty = 0 or abs(p_qty) > 100 then
    raise exception 'Quantity must be between -100 and +100, and not 0.';
  end if;

  select sizes, model_number into v_sizes, v_model from models where id = p_model_id;
  if not found then
    raise exception 'That model no longer exists.';
  end if;
  if coalesce(array_length(v_sizes, 1), 0) > 0 then
    if p_size is null or not (p_size = any (v_sizes)) then
      raise exception 'Size must be one of: %', array_to_string(v_sizes, ', ');
    end if;
  else
    p_size := null;
  end if;

  if p_qty < 0 then
    -- Leaving the warehouse: mark the oldest in-stock machines as sold.
    select count(*) into v_avail
      from machines
     where model_id = p_model_id and status = 'in_stock' and size is not distinct from p_size;
    if v_avail < -p_qty then
      raise exception 'Only % % in stock, so % can''t be taken out.',
        v_avail, v_model || coalesce(' ' || p_size, ''), -p_qty;
    end if;

    update machines set status = 'sold', sold_date = current_date, stock_reference = p_reference
     where id in (
       select id from machines
        where model_id = p_model_id and status = 'in_stock' and size is not distinct from p_size
        order by created_at
        limit -p_qty
        for update skip locked);
    get diagnostics v_done = row_count;
    return -v_done;
  else
    -- Return: put the most recently sold machines back in stock.
    update machines set status = 'in_stock', sold_date = null, stock_reference = p_reference
     where id in (
       select id from machines
        where model_id = p_model_id and status = 'sold' and size is not distinct from p_size
        order by sold_date desc nulls last, updated_at desc
        limit p_qty
        for update skip locked);
    get diagnostics v_done = row_count;

    if v_done < p_qty then
      insert into machines (model_id, size, status, notes, stock_reference)
      select p_model_id, p_size, 'in_stock', 'Return', p_reference
        from generate_series(1, p_qty - v_done);
    end if;
    return p_qty;
  end if;
end $$;

revoke all on function public.record_stock_movement(uuid, text, int, text) from public, anon;
grant execute on function public.record_stock_movement(uuid, text, int, text) to authenticated;
