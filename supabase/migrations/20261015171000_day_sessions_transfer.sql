-- Wish Money and similar transfers, as on cash_transactions.
alter table public.day_sessions drop constraint day_sessions_payment_method_check;
alter table public.day_sessions
  add constraint day_sessions_payment_method_check check (payment_method in ('cash', 'pos', 'transfer'));
