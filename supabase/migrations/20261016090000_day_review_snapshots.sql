-- What she confirmed for a day besides the client sessions: the expense lines
-- and the other income lines (insurer payments, outdoor, tests...), with her
-- labels, so the month file shows exactly what was confirmed.
alter table public.day_reviews
  add column expenses jsonb,
  add column other_income jsonb;
