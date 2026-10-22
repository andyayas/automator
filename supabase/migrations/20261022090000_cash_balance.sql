-- The cash statement's running balance on each row (its "Balance" column), so
-- the daily report can show the balance after the day's last line.
alter table public.cash_transactions add column balance numeric(12, 2);

comment on column public.cash_transactions.balance is
  'Running balance from the cash statement''s Balance column on this row (read on upload).';
