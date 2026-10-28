-- =====================================================================
-- Buffalo Machines Staff Hub: machine categories (run once)
-- Paste this whole file into Supabase > SQL Editor > New query > Run.
-- Safe to run more than once. Does not delete or change any existing data.
--
-- What it adds to each model:
--   category      Construction, Forestry or Agriculture (empty = not set yet)
-- Accessories don't need one: they follow the machine they fit.
-- Only managers can set it (existing models rules).
-- =====================================================================

alter table public.models
  add column if not exists category text
  check (category is null or category in ('Construction', 'Forestry', 'Agriculture'));
