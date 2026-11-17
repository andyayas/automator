-- The cash statement's "Audi Neo $" column (from November 2026): money put in
-- the Audi Neo bank account, noted on a cash line. Its month-to-date sum is the
-- report's Audi Bank Balance; Cash Balance is the running balance minus it.
alter table public.cash_transactions add column bank numeric(12, 2);
