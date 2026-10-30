-- =====================================================================
-- Buffalo Machines Staff Hub: prices per size (run once)
-- Paste this whole file into Supabase > SQL Editor > New query > Run.
-- Safe to run more than once. Does not delete or change any existing data.
--
-- Adds models.size_prices: for models that come in sizes, a price
-- (excluding VAT) for each size, e.g. {"1.2m": 450, "1.5m": 520}.
-- Only managers can change it (existing models rules).
-- =====================================================================

alter table public.models
  add column if not exists size_prices jsonb not null default '{}'::jsonb
  check (jsonb_typeof(size_prices) = 'object');
