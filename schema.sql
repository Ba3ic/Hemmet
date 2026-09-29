-- HEMMET: databasschema. Kör hela filen i Supabase: SQL Editor > New query > Run.
-- Kör den bara en gång på ett tomt projekt.

-- Hushåll och medlemmar
create table households(
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text unique not null default substr(md5(random()::text),1,8),
  created_by uuid default auth.uid()
);
create table members(
  household_id uuid references households on delete cascade,
  user_id uuid references auth.users on delete cascade default auth.uid(),
  primary key(household_id,user_id)
);

-- Kalender
create table events(
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households on delete cascade,
  title text not null,
  notes text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  all_day boolean not null default false,
  remind_minutes integer,            -- null = ingen notis
  created_by uuid default auth.uid()
);

-- Listor (köplista, hushållslista, egna listor)
create table lists(
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households on delete cascade,
  name text not null,
  created_at timestamptz default now()
);
create table list_items(
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references lists on delete cascade,
  household_id uuid not null references households on delete cascade,
  name text not null,
  description text,
  link text,
  image_path text,                   -- sökväg i lagringen item-images
  done boolean not null default false,
  created_at timestamptz default now()
);

-- Anteckningar
create table notes(
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households on delete cascade,
  title text not null default '',
  body text not null default '',
  updated_at timestamptz default now(),
  updated_by uuid default auth.uid()
);

-- Utgifter
create table fixed_expenses(
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households on delete cascade,
  name text not null, amount numeric not null default 0
);
create table variable_expenses(
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households on delete cascade,
  month text not null,               -- t.ex. 2026-09
  name text not null, amount numeric not null default 0
);
create table month_income(
  household_id uuid references households on delete cascade,
  month text, income numeric not null default 0,
  primary key(household_id,month)
);

-- Hjälpfunktioner
create function is_member(hid uuid) returns boolean
language sql security definer set search_path=public stable as
$$ select exists(select 1 from members where household_id=hid and user_id=auth.uid()) $$;

create function create_household(hname text) returns uuid
language plpgsql security definer set search_path=public as $$
declare hid uuid;
begin
  if auth.uid() is null then raise exception 'Inte inloggad'; end if;
  insert into households(name,created_by) values(hname,auth.uid()) returning id into hid;
  insert into members(household_id,user_id) values(hid,auth.uid());
  return hid;
end $$;

create function join_household(code text) returns uuid
language plpgsql security definer set search_path=public as $$
declare hid uuid;
begin
  if auth.uid() is null then raise exception 'Inte inloggad'; end if;
  select id into hid from households where invite_code=lower(trim(code));
  if hid is null then raise exception 'Ogiltig kod'; end if;
  insert into members(household_id,user_id) values(hid,auth.uid()) on conflict do nothing;
  return hid;
end $$;

-- Åtkomstregler (Row Level Security): bara hushållets medlemmar ser och ändrar data
alter table households enable row level security;
alter table members enable row level security;
alter table events enable row level security;
alter table lists enable row level security;
alter table list_items enable row level security;
alter table notes enable row level security;
alter table fixed_expenses enable row level security;
alter table variable_expenses enable row level security;
alter table month_income enable row level security;

create policy "läs hushåll" on households for select using (is_member(id));
create policy "läs medlemmar" on members for select using (is_member(household_id));
create policy "hushållsdata" on events for all using (is_member(household_id)) with check (is_member(household_id));
create policy "hushållsdata" on lists for all using (is_member(household_id)) with check (is_member(household_id));
create policy "hushållsdata" on list_items for all using (is_member(household_id)) with check (is_member(household_id));
create policy "hushållsdata" on notes for all using (is_member(household_id)) with check (is_member(household_id));
create policy "hushållsdata" on fixed_expenses for all using (is_member(household_id)) with check (is_member(household_id));
create policy "hushållsdata" on variable_expenses for all using (is_member(household_id)) with check (is_member(household_id));
create policy "hushållsdata" on month_income for all using (is_member(household_id)) with check (is_member(household_id));

-- Lagring för skärmdumpar (privat; mappnamn = hushålls-id)
insert into storage.buckets(id,name,public) values('item-images','item-images',false) on conflict do nothing;
create policy "bilder läs" on storage.objects for select
  using (bucket_id='item-images' and is_member(((storage.foldername(name))[1])::uuid));
create policy "bilder ladda upp" on storage.objects for insert
  with check (bucket_id='item-images' and is_member(((storage.foldername(name))[1])::uuid));
create policy "bilder ta bort" on storage.objects for delete
  using (bucket_id='item-images' and is_member(((storage.foldername(name))[1])::uuid));

-- Realtidssynk mellan era telefoner
alter publication supabase_realtime add table events, lists, list_items, notes, fixed_expenses, variable_expenses, month_income;
