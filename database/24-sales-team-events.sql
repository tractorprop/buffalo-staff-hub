-- =====================================================================
-- Buffalo Machines Staff Hub: sales team and sales-only events (run once)
-- Paste this whole file into Supabase > SQL Editor > New query > Run.
--
-- What it does:
--   * profiles.team: 'sales' for people in the sales team (empty = warehouse).
--     Only the founder can set it (from the Calendar page), through
--     set_staff_team().
--   * events.audience: 'everyone' (company events, as now) or 'sales'
--     (e.g. customer visits).
--   * Who sees events: everyone sees "everyone" events; sales-only events
--     are seen only by the sales team, managers (CEO) and the founder.
--   * Who adds events: managers, the founder AND the sales team (either
--     kind). Warehouse staff still can't add events.
--   * Who changes / deletes events: managers and the founder (any event);
--     sales staff only the events they added themselves.
--
-- What it does NOT do:
--   Existing events stay visible to everyone. Leave and other tables are
--   not changed.
--
-- Safe to run more than once.
-- =====================================================================

alter table public.profiles add column if not exists team text check (team is null or team in ('sales', 'warehouse'));
alter table public.events   add column if not exists audience text not null default 'everyone' check (audience in ('everyone', 'sales'));

create or replace function public.is_sales()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and team = 'sales');
$$;

-- Founder only: put someone in (or take them out of) the sales team.
create or replace function public.set_staff_team(p_user uuid, p_team text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_founder() then
    raise exception 'Only the founder can change teams.';
  end if;
  if p_team is not null and p_team not in ('sales', 'warehouse') then
    raise exception 'Unknown team.';
  end if;
  update public.profiles set team = p_team where id = p_user;
end $$;

revoke all on function public.set_staff_team(uuid, text) from public, anon;
grant execute on function public.set_staff_team(uuid, text) to authenticated;
revoke all on function public.is_sales() from public, anon;
grant execute on function public.is_sales() to authenticated;

drop policy if exists "staff read events"      on public.events;
drop policy if exists "manager adds events"    on public.events;
drop policy if exists "manager edits events"   on public.events;
drop policy if exists "manager deletes events" on public.events;
drop policy if exists "read events by audience"       on public.events;
drop policy if exists "managers and sales add events" on public.events;
drop policy if exists "edit own or manager"           on public.events;
drop policy if exists "delete own or manager"         on public.events;

create policy "read events by audience" on public.events for select to authenticated
  using (audience = 'everyone' or public.is_manager() or public.is_sales());
create policy "managers and sales add events" on public.events for insert to authenticated
  with check (public.is_manager() or (public.is_sales() and created_by = auth.uid()));
create policy "edit own or manager" on public.events for update to authenticated
  using (public.is_manager() or (public.is_sales() and created_by = auth.uid()))
  with check (public.is_manager() or (public.is_sales() and created_by = auth.uid()));
create policy "delete own or manager" on public.events for delete to authenticated
  using (public.is_manager() or (public.is_sales() and created_by = auth.uid()));
