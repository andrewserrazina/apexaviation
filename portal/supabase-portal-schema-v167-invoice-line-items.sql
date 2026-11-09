-- v167: real line items for invoices. Billing has been one flat
-- description+amount per invoice since launch -- no way to itemize
-- "1.5 hrs dual instruction" separately from "aircraft rental" on the
-- same bill. invoices.amount_cents stays as a maintained rollup
-- total (kept correct by the trigger below) rather than being
-- replaced, so every existing reader (Reports.jsx monthly summary,
-- Dashboard.jsx, Analytics.jsx, Payroll's revenue figures) keeps
-- working unchanged -- they all just read a number that's now
-- computed instead of hand-entered. invoices.description becomes a
-- short label/memo; the itemized breakdown lives here.

create table if not exists public.invoice_line_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  description text not null,
  amount_cents integer not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists invoice_line_items_invoice_id_idx on public.invoice_line_items(invoice_id);

alter table public.invoice_line_items enable row level security;

drop policy if exists "Admins can manage invoice line items" on public.invoice_line_items;
create policy "Admins can manage invoice line items" on public.invoice_line_items
  for all using (is_admin());

drop policy if exists "Staff can view invoice line items" on public.invoice_line_items;
create policy "Staff can view invoice line items" on public.invoice_line_items
  for select using (is_staff());

drop policy if exists "Students can view own invoice line items" on public.invoice_line_items;
create policy "Students can view own invoice line items" on public.invoice_line_items
  for select using (
    exists (select 1 from public.invoices i where i.id = invoice_line_items.invoice_id and i.student_id = auth.uid())
  );

-- Keeps invoices.amount_cents equal to sum(line items) any time a line
-- item is added, edited, or removed -- the single source of truth
-- moves to the line items, this just mirrors the total back onto the
-- parent row for every existing consumer that reads it directly.
create or replace function public.recompute_invoice_total()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  target_invoice_id uuid := coalesce(new.invoice_id, old.invoice_id);
begin
  update public.invoices
  set amount_cents = coalesce((select sum(amount_cents) from public.invoice_line_items where invoice_id = target_invoice_id), 0)
  where id = target_invoice_id;
  return null;
end;
$$;

drop trigger if exists invoice_line_items_recompute_total on public.invoice_line_items;
create trigger invoice_line_items_recompute_total
after insert or update or delete on public.invoice_line_items
for each row execute function public.recompute_invoice_total();

-- Backfill: one line item per existing invoice from its current
-- description/amount, so every invoice has a consistent itemized
-- representation going forward. Fires the trigger above, which
-- recomputes each invoice's total to the same value it already had.
insert into public.invoice_line_items (invoice_id, description, amount_cents, sort_order)
select id, coalesce(nullif(description, ''), 'Charge'), amount_cents, 0
from public.invoices
where not exists (select 1 from public.invoice_line_items where invoice_id = invoices.id);
