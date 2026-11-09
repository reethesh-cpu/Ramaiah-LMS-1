-- Multi-manager reporting.
--
-- A person can report to more than one manager. Visibility follows every
-- manager link, so a telecaller assigned to AGM, HR, and head office is visible
-- to all of them. Head office continues to see everything.

create table if not exists public.profile_managers (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  manager_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (profile_id, manager_id),
  constraint profile_managers_not_self check (profile_id <> manager_id)
);

create index if not exists profile_managers_manager_idx on public.profile_managers (manager_id);

insert into public.profile_managers (profile_id, manager_id)
select id, manager_id
from public.profiles
where manager_id is not null
on conflict (profile_id, manager_id) do nothing;

alter table public.profile_managers enable row level security;

drop policy if exists profile_managers_select on public.profile_managers;
create policy profile_managers_select on public.profile_managers
  for select to authenticated using (true);

drop policy if exists profile_managers_write on public.profile_managers;
create policy profile_managers_write on public.profile_managers
  for all to authenticated using (public.is_head_office()) with check (public.is_head_office());

grant select, insert, update, delete on public.profile_managers to authenticated;
grant all on public.profile_managers to service_role;

create or replace function public.is_manager_of(target_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $crm$
  with recursive managers as (
    select pm.manager_id as id, 1 as depth
    from public.profile_managers pm
    where pm.profile_id = target_id
    union
    select pm.manager_id, m.depth + 1
    from public.profile_managers pm
    join managers m on pm.profile_id = m.id
    where m.depth < 32
  )
  select exists (
    select 1
    from managers
    where managers.id = auth.uid()
      and managers.id <> target_id
  );
$crm$;

grant execute on function public.is_manager_of(uuid) to authenticated;
