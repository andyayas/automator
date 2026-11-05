-- Cash moved between the drawer and the clinic's bank accounts (a deposit
-- out, money in from a bank) is its own kind: not income, not an expense.
-- The running balance still includes it. Rules match isBankTransfer() in
-- src/lib/cash-statement.ts.

alter table public.cash_transactions drop constraint cash_transactions_kind_check;
alter table public.cash_transactions
  add constraint cash_transactions_kind_check
  check (kind in ('session', 'package', 'insurance_copay', 'insurer_payment', 'expense', 'other', 'transfer'));

-- Re-uploads don't change a stored row's kind, so classify the rows already in.
update public.cash_transactions
set kind = 'transfer'
where (credit is not null and debit is null and lower(coalesce(description, '')) ~ '^\s*deposit\y')
   or (debit is not null
       and (lower(coalesce(name_raw, '')) ~ '\y(audi|sgbl|bank)\y' or lower(coalesce(description, '')) ~ '\y(audi|sgbl|bank)\y')
       and lower(coalesce(description, '')) !~ '(session|package|pkg|physio|insurance)');
