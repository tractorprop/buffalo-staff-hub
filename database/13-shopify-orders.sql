-- =====================================================================
-- Buffalo Machines Staff Hub: Shopify orders on the Stock entry page (run once)
-- Paste this whole file into Supabase > SQL Editor > New query > Run.
--
-- What it does:
--   * shopify_orders: new Shopify orders, so the warehouse can load them on
--     the Stock entry page. Only the order number, date and the listings and
--     quantities are kept. NO customer names, addresses, emails or phones.
--     Staff can read them; managers can remove one (e.g. a cancelled order).
--   * shopify_links: which Shopify listing is which item in the hub. Several
--     listings can point to the same hub item. Staff can read them; only the
--     founder can add or change links.
--   * shopify_settings: holds the Shopify signing key. No policies at all,
--     so nobody can read it through the website or the API.
--   * receive_shopify_order(): called by the "shopify-order" Edge Function.
--     It only accepts an order carrying Shopify's correct signature, then
--     saves just the fields above and throws the rest away.
--
-- What it does NOT do:
--   It changes no existing table, policy or trigger, and takes nothing out
--   of stock. Stock only comes off when staff click "Packed & sent".
--
-- AFTER running this, add your Shopify signing key with this ONE line in a
-- new query (replace the text between the quotes with your key):
--
--   insert into public.shopify_settings (id, webhook_secret) values (1, 'PASTE-KEY-HERE')
--   on conflict (id) do update set webhook_secret = excluded.webhook_secret;
--
-- Safe to run more than once.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.shopify_orders (
  id          bigint primary key,       -- Shopify's own order id
  name        text not null,            -- order number as shown in Shopify, e.g. #1052
  ordered_at  timestamptz not null,
  items       jsonb not null,           -- [{key, title, qty}] - no customer details
  created_at  timestamptz not null default now()
);

create table if not exists public.shopify_links (
  item_key   text primary key,          -- 'variant:<Shopify variant id>' (or 'title:<name>' for custom items)
  model_id   uuid references public.models (id) on delete cascade,  -- empty = "not a stock item"
  size       text,
  title      text not null,             -- the Shopify listing name, for reference
  linked_at  timestamptz not null default now()
);

create table if not exists public.shopify_settings (
  id              int primary key default 1 check (id = 1),
  webhook_secret  text not null
);

alter table public.shopify_orders   enable row level security;
alter table public.shopify_links    enable row level security;
alter table public.shopify_settings enable row level security;
revoke all on public.shopify_settings from anon, authenticated;

drop policy if exists "staff read shopify orders"      on public.shopify_orders;
drop policy if exists "manager removes shopify orders" on public.shopify_orders;
create policy "staff read shopify orders"      on public.shopify_orders for select to authenticated using (true);
create policy "manager removes shopify orders" on public.shopify_orders for delete to authenticated using (public.is_manager());

drop policy if exists "staff read shopify links"     on public.shopify_links;
drop policy if exists "founder adds shopify links"   on public.shopify_links;
drop policy if exists "founder edits shopify links"  on public.shopify_links;
drop policy if exists "founder removes shopify links" on public.shopify_links;
create policy "staff read shopify links"      on public.shopify_links for select to authenticated using (true);
create policy "founder adds shopify links"    on public.shopify_links for insert to authenticated with check (public.is_founder());
create policy "founder edits shopify links"   on public.shopify_links for update to authenticated using (public.is_founder()) with check (public.is_founder());
create policy "founder removes shopify links" on public.shopify_links for delete to authenticated using (public.is_founder());

create or replace function public.receive_shopify_order(p_body text, p_hmac text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_secret text;
  v_order  jsonb;
begin
  select webhook_secret into v_secret from shopify_settings where id = 1;
  if v_secret is null then
    raise exception 'Shopify signing key not set yet.';
  end if;
  if p_hmac is null
     or encode(hmac(convert_to(p_body, 'UTF8'), convert_to(v_secret, 'UTF8'), 'sha256'), 'base64') <> p_hmac then
    raise exception 'Not a genuine Shopify order.';
  end if;

  v_order := p_body::jsonb;
  insert into shopify_orders (id, name, ordered_at, items)
  values (
    (v_order ->> 'id')::bigint,
    coalesce(v_order ->> 'name', '#' || (v_order ->> 'order_number')),
    coalesce((v_order ->> 'created_at')::timestamptz, now()),
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'key',   coalesce('variant:' || (li ->> 'variant_id'), 'title:' || (li ->> 'title')),
               'title', concat_ws(' – ', li ->> 'title', nullif(nullif(li ->> 'variant_title', ''), 'Default Title')),
               'qty',   (li ->> 'quantity')::int))
        from jsonb_array_elements(v_order -> 'line_items') li), '[]'::jsonb)
  )
  on conflict (id) do nothing;   -- Shopify sometimes sends the same order twice
end $$;

revoke all on function public.receive_shopify_order(text, text) from public;
grant execute on function public.receive_shopify_order(text, text) to anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'shopify_orders') then
    alter publication supabase_realtime add table public.shopify_orders;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'shopify_links') then
    alter publication supabase_realtime add table public.shopify_links;
  end if;
end $$;
