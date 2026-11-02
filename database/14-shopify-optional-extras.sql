-- =====================================================================
-- Buffalo Machines Staff Hub: Shopify optional extras (YMQ) (run once)
-- Paste this whole file into Supabase > SQL Editor > New query > Run.
-- Run 13-shopify-orders.sql first.
--
-- What it does:
--   Updates receive_shopify_order so the optional extras customers choose on
--   a machine listing (the YMQ "Optional Extras" note, e.g.
--   "Ripper, Quick Hitch, Hydraulic Thumb | £1,285.00") each become their own
--   item on the order. The founder links each extra to a hub accessory once,
--   then every order with that extra loads it automatically.
--   Only notes whose name contains "extra" are read; nothing else is kept.
--
-- What it does NOT do:
--   No tables, policies or stock change. Orders already received are not
--   updated (their extras weren't kept).
--
-- Safe to run more than once.
-- =====================================================================

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
    (
      select coalesce(jsonb_agg(x.item order by x.line_no, x.extra_no), '[]'::jsonb)
        from (
          -- the listing itself (e.g. the machine)
          select jsonb_build_object(
                   'key',   coalesce('variant:' || (li ->> 'variant_id'), 'title:' || (li ->> 'title')),
                   'title', concat_ws(' – ', li ->> 'title', nullif(nullif(li ->> 'variant_title', ''), 'Default Title')),
                   'qty',   (li ->> 'quantity')::int) as item,
                 line_no, 0 as extra_no
            from jsonb_array_elements(v_order -> 'line_items') with ordinality as l(li, line_no)
          union all
          -- each optional extra chosen on that listing (YMQ "_Optional Extras: A, B, C | £price")
          select jsonb_build_object(
                   'key',   'extra:' || coalesce(li ->> 'product_id', li ->> 'title') || ':' || lower(trim(e.extra)),
                   'title', trim(e.extra) || ' (extra on ' || (li ->> 'title') || ')',
                   'qty',   (li ->> 'quantity')::int),
                 line_no, e.extra_no
            from jsonb_array_elements(v_order -> 'line_items') with ordinality as l(li, line_no)
            cross join lateral jsonb_array_elements(coalesce(li -> 'properties', '[]'::jsonb)) as p(prop)
            cross join lateral unnest(string_to_array(split_part(p.prop ->> 'value', '|', 1), ',')) with ordinality as e(extra, extra_no)
           where p.prop ->> 'name' ~* 'extra'
             and trim(e.extra) <> ''
        ) x
    )
  )
  on conflict (id) do nothing;   -- Shopify sometimes sends the same order twice
end $$;

revoke all on function public.receive_shopify_order(text, text) from public;
grant execute on function public.receive_shopify_order(text, text) to anon, authenticated;
