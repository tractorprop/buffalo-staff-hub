-- =====================================================================
-- Buffalo Machines Staff Hub: stock entry for all staff (run once)
-- Paste this whole file into Supabase > SQL Editor > New query > Run.
--
-- What it does:
--   Adds ONE function, record_stock_movement, that any signed-in staff member
--   can call from the "Stock entry" page:
--     * a negative quantity (e.g. -2) marks that many In stock machines of a
--       model (and size) as Sold, oldest first;
--     * a positive quantity (e.g. +1, a return) puts that many Sold machines
--       back In stock, most recently sold first. If there aren't enough sold
--       records, it adds new In stock machines marked "Return".
--
-- What it does NOT do:
--   It does not change any table, policy or trigger. Staff still cannot add,
--   edit or delete models, containers or machines directly. Every change is
--   recorded in the activity log under the person's name, and the restock
--   alert still fires when a return puts a model back in stock.
--
-- Safe to run more than once.
-- =====================================================================

create or replace function public.record_stock_movement(p_model_id uuid, p_size text, p_qty int)
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

    update machines set status = 'sold', sold_date = current_date
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
    update machines set status = 'in_stock', sold_date = null
     where id in (
       select id from machines
        where model_id = p_model_id and status = 'sold' and size is not distinct from p_size
        order by sold_date desc nulls last, updated_at desc
        limit p_qty
        for update skip locked);
    get diagnostics v_done = row_count;

    if v_done < p_qty then
      insert into machines (model_id, size, status, notes)
      select p_model_id, p_size, 'in_stock', 'Return'
        from generate_series(1, p_qty - v_done);
    end if;
    return p_qty;
  end if;
end $$;

revoke all on function public.record_stock_movement(uuid, text, int) from public, anon;
grant execute on function public.record_stock_movement(uuid, text, int) to authenticated;
