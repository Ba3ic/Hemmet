-- HEMMET, migrering 003: privata personliga flikar.
-- Kör hela filen en gång i Supabase: SQL Editor > New query > Run. Kräver 002.
--
-- Personliga rader (owner satt) kan nu bara läsas av ägaren. Gemensamma rader (owner null)
-- läser båda som förut. Realtid följer samma regler, så sambons ändringar i sin egen flik
-- skickas inte heller ut. Ingen data ändras.

begin;

drop policy "läs" on fixed_expenses;
drop policy "läs" on variable_expenses;
drop policy "läs" on categories;
drop policy "läs" on incomes;

create policy "läs" on fixed_expenses for select using (is_member(household_id) and (owner is null or owner = auth.uid()));
create policy "läs" on variable_expenses for select using (is_member(household_id) and (owner is null or owner = auth.uid()));
create policy "läs" on categories for select using (is_member(household_id) and (owner is null or owner = auth.uid()));
create policy "läs" on incomes for select using (is_member(household_id) and owner = auth.uid());

commit;
