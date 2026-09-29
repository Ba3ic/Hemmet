-- HEMMET, migrering 001: fasta utgifter som gäller framåt + kategorin "Övrigt".
-- Kör hela filen en gång i Supabase: SQL Editor > New query > Run.
-- Inga tabeller tas bort och ingen data raderas. RLS-reglerna och realtiden gäller som förut.

begin;

-- 1. Fasta utgifter får ett giltighetsintervall (månader som 'YYYY-MM', båda inklusive).
--    start_month: första månaden utgiften gäller.
--    end_month:   sista månaden den gäller, null = tills vidare.
--    "Ta bort" i appen sätter end_month i stället för att radera, och en ändring avslutar
--    den gamla raden och skapar en ny från och med månaden man står i. Så påverkas
--    tidigare månader aldrig.
alter table fixed_expenses
  add column start_month text,
  add column end_month text;

-- Befintliga fasta utgifter börjar gälla innevarande månad (appen togs i bruk nu).
update fixed_expenses
  set start_month = to_char(now() at time zone 'Europe/Stockholm', 'YYYY-MM')
  where start_month is null;

alter table fixed_expenses
  alter column start_month set not null,
  alter column start_month set default to_char(now() at time zone 'Europe/Stockholm', 'YYYY-MM'),
  add constraint fixed_expenses_start_month_format check (start_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  add constraint fixed_expenses_end_month_format check (end_month is null or end_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  add constraint fixed_expenses_month_order check (end_month is null or end_month >= start_month);

-- 2. Rörliga utgifter får en kategori: 'rorlig' (vanlig rörlig) eller 'ovrigt'
--    (engångsköp, presenter o.d.). Befintliga rader blir 'rorlig'.
alter table variable_expenses
  add column category text not null default 'rorlig',
  add constraint variable_expenses_category_check check (category in ('rorlig', 'ovrigt'));

commit;
