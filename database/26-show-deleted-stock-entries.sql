-- =====================================================================
-- Buffalo Machines Staff Hub: show deleted stock entries in the history (run once)
-- Run 25-undo-stock-entry.sql first.
-- Paste this whole file into Supabase > SQL Editor > New query > Run.
--
-- What it does:
--   * Updates undo_stock_entry() so that deleting a stock entry also leaves
--     one line in the Stock entry history: what was deleted (items,
--     reference, who entered it and when), who deleted it and when.
--   * Lets all staff read those "deleted" lines, like the rest of the Stock
--     entry history (other history stays CEO and founder only).
--
-- What it does NOT do:
--   No tables change. Stock is put back exactly as before.
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
  v_items jsonb := '[]'::jsonb;
  v_first public.audit_log;
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
    -- Remember what the entry was, for the "deleted" line in the history.
    v_first := coalesce(v_first, a);
    v_items := v_items || jsonb_build_object(
      'model_id', coalesce(a.new_data ->> 'model_id', a.old_data ->> 'model_id'),
      'size', coalesce(a.new_data ->> 'size', a.old_data ->> 'size'),
      'qty', case when a.new_data ->> 'status' = 'sold' then -1 else 1 end);
    get diagnostics n = row_count;
    v_done := v_done + n;
  end loop;

  -- Remove the entry from the history, and the activity rows this undo just wrote (same moment).
  delete from public.audit_log where id = any (p_audit_ids);
  delete from public.audit_log where table_name = 'machines' and record_id = any (v_ids) and changed_at = now();

  -- Leave one line in the Stock entry history saying what was deleted, by whom and when.
  if v_first.id is not null then
    insert into public.audit_log (table_name, record_id, action, changed_by, old_data)
    values ('stock_entry_deleted', null, 'DELETE', auth.uid(), jsonb_build_object(
      'entry_at', v_first.changed_at,
      'entry_by', v_first.changed_by,
      'reference', v_first.new_data ->> 'stock_reference',
      'items', v_items,
      'put_back', v_done));
  end if;
  return v_done;
end $$;

revoke all on function public.undo_stock_entry(bigint[]) from public, anon;
grant execute on function public.undo_stock_entry(bigint[]) to authenticated;

drop policy if exists "staff read stock history, managers read all" on public.audit_log;
create policy "staff read stock history, managers read all" on public.audit_log for select to authenticated
  using (table_name in ('machines', 'stock_entry_deleted') or public.is_manager());
