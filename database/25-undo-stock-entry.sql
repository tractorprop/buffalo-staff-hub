-- =====================================================================
-- Buffalo Machines Staff Hub: deleting a stock entry puts the stock back (run once)
-- Paste this whole file into Supabase > SQL Editor > New query > Run.
--
-- What it does:
--   Adds undo_stock_entry(), used by "Delete" on the Stock entry history.
--   Only the CEO (managers) and the founder can use it. It reverses exactly
--   the machines in that entry:
--     * left (sold)  -> back in stock
--     * returned     -> back to sold (or removed, if the return created it)
--   then removes the entry from the history (and the undo itself, so no
--   confusing extra line appears). Machines that have changed since (e.g.
--   sold again) are left alone. All in one go: it either all happens or none.
--
-- What it does NOT do:
--   No tables or policies change.
--
-- Safe to run more than once.
-- =====================================================================

create or replace function public.undo_stock_entry(p_audit_ids bigint[])
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.audit_log;
  v_done int := 0;
  v_ids uuid[] := '{}';
  n int;
begin
  if not public.is_manager() then
    raise exception 'Only the CEO or the founder can delete a stock entry.';
  end if;

  for a in select * from public.audit_log where id = any (p_audit_ids) and table_name = 'machines' loop
    v_ids := v_ids || a.record_id;
    if a.action = 'UPDATE' and a.old_data ->> 'status' = 'in_stock' and a.new_data ->> 'status' = 'sold' then
      -- It left the warehouse: put it back in stock.
      update public.machines
         set status = 'in_stock', sold_date = null, stock_reference = a.old_data ->> 'stock_reference'
       where id = a.record_id and status = 'sold';
    elsif a.action = 'UPDATE' and a.old_data ->> 'status' = 'sold' and a.new_data ->> 'status' = 'in_stock' then
      -- It was returned: mark it sold again, as it was.
      update public.machines
         set status = 'sold', sold_date = (a.old_data ->> 'sold_date')::date, stock_reference = a.old_data ->> 'stock_reference'
       where id = a.record_id and status = 'in_stock';
    elsif a.action = 'INSERT' and a.new_data ->> 'status' = 'in_stock' and a.new_data ->> 'notes' = 'Return' then
      -- The return added a new record: remove it.
      delete from public.machines where id = a.record_id and status = 'in_stock';
    else
      continue;
    end if;
    get diagnostics n = row_count;
    v_done := v_done + n;
  end loop;

  -- Remove the entry from the history, and the activity rows this undo just wrote (same moment).
  delete from public.audit_log where id = any (p_audit_ids);
  delete from public.audit_log where table_name = 'machines' and record_id = any (v_ids) and changed_at = now();
  return v_done;
end $$;

revoke all on function public.undo_stock_entry(bigint[]) from public, anon;
grant execute on function public.undo_stock_entry(bigint[]) to authenticated;
