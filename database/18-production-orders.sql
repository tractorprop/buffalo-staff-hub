-- =====================================================================
-- Buffalo Machines Staff Hub: machines in production (run once)
-- Paste this whole file into Supabase > SQL Editor > New query > Run.
--
-- What it does:
--   Adds one table, production_orders: machines and accessories ordered from
--   the factory that are still being built (not yet in a container).
--   Each order has a reference, the date it should leave the factory, an ETA
--   in the UK, notes, and what's in it.
--   * All signed-in staff can see them (to plan around low stock).
--   * Only the founder can add, change, ship or delete them.
--   When an order leaves the factory, the founder clicks "Shipped" and it
--   becomes a container on the way (the normal machines/containers system).
--   Changes are recorded in the activity log.
--
-- What it does NOT do:
--   It changes no existing table, policy or trigger, and doesn't touch stock.
--
-- Safe to run more than once.
-- =====================================================================

create table if not exists public.production_orders (
  id          uuid primary key default gen_random_uuid(),
  ref         text not null check (length(trim(ref)) between 1 and 60),
  ready_date  date,                                -- expected to leave the factory
  eta         date,                                -- expected arrival in the UK
  items       jsonb not null default '[]'::jsonb,  -- [{model_id, size, qty}]
  notes       text,
  created_by  uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists production_orders_touch on public.production_orders;
create trigger production_orders_touch before update on public.production_orders
  for each row execute function public.touch_updated_at();

drop trigger if exists production_orders_audit on public.production_orders;
create trigger production_orders_audit after insert or update or delete on public.production_orders
  for each row execute function public.log_change();

alter table public.production_orders enable row level security;

drop policy if exists "staff read production"     on public.production_orders;
drop policy if exists "founder adds production"   on public.production_orders;
drop policy if exists "founder edits production"  on public.production_orders;
drop policy if exists "founder deletes production" on public.production_orders;
create policy "staff read production"      on public.production_orders for select to authenticated using (true);
create policy "founder adds production"    on public.production_orders for insert to authenticated with check (public.is_founder());
create policy "founder edits production"   on public.production_orders for update to authenticated using (public.is_founder()) with check (public.is_founder());
create policy "founder deletes production" on public.production_orders for delete to authenticated using (public.is_founder());

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'production_orders') then
    alter publication supabase_realtime add table public.production_orders;
  end if;
end $$;
