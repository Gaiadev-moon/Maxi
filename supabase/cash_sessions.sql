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

alter table public.cash_sessions enable row level security;
grant select, insert, update, delete on public.cash_sessions to authenticated;

drop policy if exists "Authenticated staff manage cash sessions" on public.cash_sessions;
create policy "Authenticated staff manage cash sessions" on public.cash_sessions
  for all to authenticated using (true) with check (true);

do $$
begin
  alter publication supabase_realtime add table public.cash_sessions;
exception when duplicate_object then null;
end $$;
