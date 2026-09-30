-- HEMMET, migrering 002: personliga flikar, kategorier och personlig inkomst.
-- Kör hela filen en gång i Supabase: SQL Editor > New query > Run. Kräver 001.
--
-- Ingen utgift raderas. Befintliga utgifter blir gemensamma (owner = null) och får
-- kategorin Övrigt, utom de som heter exakt som en standardkategori (t.ex. "Mat"),
-- som får den kategorin. Sektionen "Övrigt" (variable_expenses.category) ersätts av
-- kategorin Övrigt.

begin;

-- ---------- 1. Namn och andel per person ----------
-- display_name: visas som flik under Utgifter (t.ex. "Lucas").
-- split_percent: personens andel av gemensamma utgifter. 50 för båda i dag.
alter table members
  add column display_name text check (display_name is null or length(display_name) between 1 and 30),
  add column split_percent numeric not null default 50 check (split_percent between 0 and 100);

-- members har bara en läsregel, så namnet sätts via en funktion som bara rör den egna raden.
create function set_my_profile(p_household uuid, p_name text) returns void
language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null then raise exception 'Inte inloggad'; end if;
  update members set display_name = nullif(trim(p_name), '')
    where household_id = p_household and user_id = auth.uid();
end $$;

-- ---------- 2. Kategorier ----------
-- owner null = gemensam kategori, annars personens egen. Övrigt (is_fallback) finns
-- en gång per hushåll, är gemensam och kan inte tas bort.
create table categories(
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households on delete cascade,
  owner uuid references auth.users on delete cascade,
  name text not null check (length(trim(name)) between 1 and 40),
  is_fallback boolean not null default false,
  created_at timestamptz not null default now(),
  check (not is_fallback or owner is null)
);
create unique index categories_one_fallback on categories(household_id) where is_fallback;
create unique index categories_unique_name on categories(
  household_id, coalesce(owner, '00000000-0000-0000-0000-000000000000'::uuid), lower(trim(name)));

create function seed_categories(hid uuid) returns void
language sql security definer set search_path=public as $$
  insert into categories(household_id, name, is_fallback, created_at)
  select hid, n, n = 'Övrigt', now() + (i * interval '1 millisecond')
  from unnest(array['Mat','Utemat','Boende','Transport','Nöje','Övrigt']) with ordinality as t(n, i)
  on conflict do nothing;
$$;
revoke execute on function seed_categories(uuid) from public, anon, authenticated;

create function households_seed_categories() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  perform seed_categories(new.id);
  return new;
end $$;
create trigger households_seed_categories after insert on households
  for each row execute function households_seed_categories();

select seed_categories(id) from households;

-- ---------- 3. Ägare och kategori på utgifter ----------
alter table fixed_expenses
  add column owner uuid references auth.users on delete cascade,
  add column category_id uuid references categories;
alter table variable_expenses
  add column owner uuid references auth.users on delete cascade,
  add column category_id uuid references categories;

-- Befintliga rader: kategori efter namn om det matchar exakt, annars Övrigt.
update fixed_expenses e set category_id = coalesce(
  (select c.id from categories c where c.household_id = e.household_id and c.owner is null and lower(c.name) = lower(trim(e.name))),
  (select c.id from categories c where c.household_id = e.household_id and c.is_fallback));
update variable_expenses e set category_id = coalesce(
  (select c.id from categories c where c.household_id = e.household_id and c.owner is null and lower(c.name) = lower(trim(e.name))),
  (select c.id from categories c where c.household_id = e.household_id and c.is_fallback));

alter table fixed_expenses alter column category_id set not null;
alter table variable_expenses alter column category_id set not null;
create index fixed_expenses_category on fixed_expenses(category_id);
create index variable_expenses_category on variable_expenses(category_id);

-- Den gamla indelningen rörlig/övrigt ersätts av kategorin.
alter table variable_expenses drop constraint variable_expenses_category_check;
alter table variable_expenses drop column category;

-- Utan kategori → Övrigt. Kategorin måste höra till samma hushåll.
create function expenses_check_category() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if new.category_id is null then
    select id into new.category_id from categories where household_id = new.household_id and is_fallback;
  elsif not exists (select 1 from categories where id = new.category_id and household_id = new.household_id) then
    raise exception 'Kategorin hör inte till hushållet';
  end if;
  return new;
end $$;
create trigger fixed_expenses_category before insert or update of category_id, household_id on fixed_expenses
  for each row execute function expenses_check_category();
create trigger variable_expenses_category before insert or update of category_id, household_id on variable_expenses
  for each row execute function expenses_check_category();

-- En kategori som tas bort: dess utgifter flyttas till Övrigt först. Övrigt kan inte tas bort
-- (utom när hela hushållet tas bort).
create function categories_before_delete() returns trigger
language plpgsql security definer set search_path=public as $$
declare fallback uuid;
begin
  if not exists (select 1 from households where id = old.household_id) then return old; end if;
  if old.is_fallback then raise exception 'Övrigt kan inte tas bort'; end if;
  select id into fallback from categories where household_id = old.household_id and is_fallback;
  update fixed_expenses set category_id = fallback where category_id = old.id;
  update variable_expenses set category_id = fallback where category_id = old.id;
  return old;
end $$;
create trigger categories_before_delete before delete on categories
  for each row execute function categories_before_delete();

create function categories_keep_fallback() returns trigger
language plpgsql as $$
begin
  if old.is_fallback <> new.is_fallback or old.owner is distinct from new.owner
     or old.household_id <> new.household_id then
    raise exception 'Kategorins ägare kan inte ändras';
  end if;
  return new;
end $$;
create trigger categories_keep_fallback before update on categories
  for each row execute function categories_keep_fallback();

-- ---------- 4. Personlig inkomst ----------
-- En rad gäller månaden month. Återkommande (recurring) gäller från month till end_month
-- (null = tills vidare). En justering för en enskild månad är en icke-återkommande rad
-- med replaces_id = den återkommande raden; den ersätter beloppet just den månaden.
create table incomes(
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households on delete cascade,
  owner uuid not null default auth.uid() references auth.users on delete cascade,
  description text not null default '' check (length(description) <= 80),
  amount numeric not null default 0,
  month text not null check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  recurring boolean not null default false,
  end_month text check (end_month is null or end_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  replaces_id uuid references incomes on delete cascade,
  created_at timestamptz not null default now(),
  check (end_month is null or (recurring and end_month >= month)),
  check (replaces_id is null or not recurring)
);
create index incomes_household on incomes(household_id, owner);
create unique index incomes_one_adjustment on incomes(replaces_id, month) where replaces_id is not null;

-- ---------- 5. Åtkomstregler ----------
-- Alla i hushållet läser allt. Gemensamma rader (owner null) ändrar båda,
-- personliga rader bara ägaren.
drop policy "hushållsdata" on fixed_expenses;
drop policy "hushållsdata" on variable_expenses;

create policy "läs" on fixed_expenses for select using (is_member(household_id));
create policy "lägg till" on fixed_expenses for insert with check (is_member(household_id) and (owner is null or owner = auth.uid()));
create policy "ändra" on fixed_expenses for update using (is_member(household_id) and (owner is null or owner = auth.uid())) with check (is_member(household_id) and (owner is null or owner = auth.uid()));
create policy "ta bort" on fixed_expenses for delete using (is_member(household_id) and (owner is null or owner = auth.uid()));

create policy "läs" on variable_expenses for select using (is_member(household_id));
create policy "lägg till" on variable_expenses for insert with check (is_member(household_id) and (owner is null or owner = auth.uid()));
create policy "ändra" on variable_expenses for update using (is_member(household_id) and (owner is null or owner = auth.uid())) with check (is_member(household_id) and (owner is null or owner = auth.uid()));
create policy "ta bort" on variable_expenses for delete using (is_member(household_id) and (owner is null or owner = auth.uid()));

alter table categories enable row level security;
create policy "läs" on categories for select using (is_member(household_id));
create policy "lägg till" on categories for insert with check (is_member(household_id) and not is_fallback and (owner is null or owner = auth.uid()));
create policy "ändra" on categories for update using (is_member(household_id) and (owner is null or owner = auth.uid())) with check (is_member(household_id) and (owner is null or owner = auth.uid()));
create policy "ta bort" on categories for delete using (is_member(household_id) and (owner is null or owner = auth.uid()));

alter table incomes enable row level security;
create policy "läs" on incomes for select using (is_member(household_id));
create policy "lägg till" on incomes for insert with check (is_member(household_id) and owner = auth.uid());
create policy "ändra" on incomes for update using (is_member(household_id) and owner = auth.uid()) with check (is_member(household_id) and owner = auth.uid());
create policy "ta bort" on incomes for delete using (is_member(household_id) and owner = auth.uid());

-- ---------- 6. Realtid ----------
alter publication supabase_realtime add table categories, incomes, members;

commit;
