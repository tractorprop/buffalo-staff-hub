-- =====================================================================
-- Buffalo Machines Staff Hub: customer name on invoices (run once)
-- Paste this whole file into Supabase > SQL Editor > New query > Run.
--
-- What it does:
--   Adds one column, invoices.customer_name, so the invoice history can show
--   who each invoice was for, and a reprint fills the name in automatically.
--   ONLY the name is kept: no address, phone or email.
--   Invoices made before this have no name stored.
--
-- What it does NOT do:
--   No policies or other tables change.
--
-- Safe to run more than once.
-- =====================================================================

alter table public.invoices add column if not exists customer_name text
  check (customer_name is null or length(customer_name) <= 200);
