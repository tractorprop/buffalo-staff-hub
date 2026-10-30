-- =====================================================================
-- Buffalo Machines Staff Hub: prices include VAT (run once)
-- Paste this whole file into Supabase > SQL Editor > New query > Run.
--
-- From now on prices are typed INCLUDING VAT, so invoices match the
-- website price exactly. This converts any prices already entered
-- (which were excluding VAT) by adding 20%, ONE TIME ONLY.
-- Safe to run more than once: the conversion is recorded and never repeats.
-- =====================================================================

alter table public.company_settings
  add column if not exists prices_include_vat boolean not null default false;

do $$
begin
  if not (select prices_include_vat from public.company_settings where id = 1) then
    update public.models set price = round(price * 1.2, 2) where price is not null;

    update public.models m
       set size_prices = coalesce((
             select jsonb_object_agg(key, round((value::text)::numeric * 1.2, 2))
               from jsonb_each(m.size_prices)), '{}'::jsonb)
     where m.size_prices <> '{}'::jsonb;

    update public.company_settings set prices_include_vat = true where id = 1;
  end if;
end $$;
