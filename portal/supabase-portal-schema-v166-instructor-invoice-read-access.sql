-- v166: instructors could pick a student in Billing.jsx and the query
-- would silently return zero rows -- the only SELECT policy on
-- invoices covered the student themselves or an admin, with no grant
-- for the instructor role at all. Every other staff-facing table in
-- this schema (maintenance_records, squawks, etc.) already trusts
-- is_staff() (admin OR instructor) for read access; this brings
-- invoices in line with that existing convention rather than
-- inventing a narrower "only this instructor's own students" rule
-- nothing else in the app enforces.

drop policy if exists "Staff can view all invoices" on public.invoices;
create policy "Staff can view all invoices" on public.invoices
  for select using (is_staff());
