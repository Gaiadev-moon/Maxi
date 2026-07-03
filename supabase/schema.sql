create table if not exists public.app_settings (
  id text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.products (
  id text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.sales (
  id text primary key,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.bar_tables (
  id text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.cash_sessions (
  id text primary key,
  payload jsonb not null,
  opened_at timestamptz not null,
  closed_at timestamptz,
  updated_at timestamptz not null default now()
);

create unique index if not exists one_open_cash_session_per_area
  on public.cash_sessions ((payload ->> 'area'))
  where payload ->> 'status' = 'abierta';

alter table public.app_settings enable row level security;
alter table public.products enable row level security;
alter table public.sales enable row level security;
alter table public.bar_tables enable row level security;
alter table public.cash_sessions enable row level security;

grant select, insert, update, delete on public.app_settings to authenticated;
grant select, insert, update, delete on public.products to authenticated;
grant select, insert, update, delete on public.sales to authenticated;
grant select, insert, update, delete on public.bar_tables to authenticated;
grant select, insert, update, delete on public.cash_sessions to authenticated;

drop policy if exists "Authenticated staff manage settings" on public.app_settings;
create policy "Authenticated staff manage settings" on public.app_settings
  for all to authenticated using (true) with check (true);

drop policy if exists "Authenticated staff manage products" on public.products;
create policy "Authenticated staff manage products" on public.products
  for all to authenticated using (true) with check (true);

drop policy if exists "Authenticated staff manage sales" on public.sales;
create policy "Authenticated staff manage sales" on public.sales
  for all to authenticated using (true) with check (true);

drop policy if exists "Authenticated staff manage tables" on public.bar_tables;
create policy "Authenticated staff manage tables" on public.bar_tables
  for all to authenticated using (true) with check (true);

drop policy if exists "Authenticated staff manage cash sessions" on public.cash_sessions;
create policy "Authenticated staff manage cash sessions" on public.cash_sessions
  for all to authenticated using (true) with check (true);

do $$
begin
  alter publication supabase_realtime add table public.app_settings;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.products;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.sales;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.bar_tables;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.cash_sessions;
exception when duplicate_object then null;
end $$;
