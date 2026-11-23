-- Org Chart Sandbox: private, allow-listed, shared storage. Run once in the Supabase SQL editor of a NEW project.
-- Then: turn off "Allow new users to sign up" (Authentication > Sign In / Providers) and set the Site URL
-- (Authentication > URL Configuration) to wherever you host web/.

-- Who may use the app. Clients cannot read or write this table; edit it from the SQL editor / service role.
create table if not exists public.allowed_emails (
  email text primary key check (email = lower(email))
);
alter table public.allowed_emails enable row level security;

insert into public.allowed_emails (email) values
  ('you@example.com'),          -- REPLACE with real, lowercase addresses
  ('teammate@example.com')
on conflict do nothing;

create or replace function public.is_allowed() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.allowed_emails
                 where email = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;
revoke all on function public.is_allowed() from public;
grant execute on function public.is_allowed() to authenticated;

-- Baseline snapshot of the current org (people, teams, memberships), phone numbers stripped.
create table if not exists public.snapshot (
  id int primary key default 1 check (id = 1),
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.snapshot enable row level security;
create policy snapshot_read on public.snapshot for select to authenticated using (public.is_allowed());

-- Shared mocks. Everyone allowed can read all of them; only a mock's creator can change or delete it
-- (everyone else duplicates it into their own).
create table if not exists public.scenarios (
  id text primary key,
  name text not null,
  state jsonb not null,
  created_by text not null default lower(coalesce(auth.jwt() ->> 'email', '')),
  updated_by text not null default lower(coalesce(auth.jwt() ->> 'email', '')),
  updated_at timestamptz not null default now()
);
alter table public.scenarios enable row level security;
create policy scenarios_read on public.scenarios for select to authenticated using (public.is_allowed());
create policy scenarios_insert on public.scenarios for insert to authenticated
  with check (public.is_allowed() and created_by = lower(coalesce(auth.jwt() ->> 'email', '')));
create policy scenarios_update on public.scenarios for update to authenticated
  using (public.is_allowed() and created_by = lower(coalesce(auth.jwt() ->> 'email', '')))
  with check (public.is_allowed() and created_by = lower(coalesce(auth.jwt() ->> 'email', '')));
create policy scenarios_delete on public.scenarios for delete to authenticated
  using (public.is_allowed() and created_by = lower(coalesce(auth.jwt() ->> 'email', '')));

create or replace function public.touch_scenario() returns trigger
language plpgsql security definer set search_path = public as $$
declare me text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' then new.created_by := old.created_by; end if;
  if me <> '' then new.updated_by := me; if tg_op = 'INSERT' then new.created_by := me; end if; end if;
  return new;
end $$;
drop trigger if exists scenarios_touch on public.scenarios;
create trigger scenarios_touch before insert or update on public.scenarios
  for each row execute function public.touch_scenario();

alter publication supabase_realtime add table public.scenarios;

-- Private photo bucket, readable only by allow-listed users.
insert into storage.buckets (id, name, public) values ('avatars', 'avatars', false)
on conflict (id) do update set public = false;
create policy avatars_read on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and public.is_allowed());
