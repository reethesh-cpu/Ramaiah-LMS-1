-- Northstar CRM - complete initial schema
-- Safe to run more than once in the Supabase SQL Editor.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Core tables
-- ---------------------------------------------------------------------------

create table if not exists public.role_definitions (
  role_code  text primary key,
  label      text not null,
  is_system  boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null unique,
  full_name   text not null,
  role_code   text not null references public.role_definitions (role_code),
  manager_id  uuid references public.profiles (id) on delete set null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.profile_managers (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  manager_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (profile_id, manager_id),
  constraint profile_managers_not_self check (profile_id <> manager_id)
);

create table if not exists public.categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  is_active   boolean not null default true,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);

create table if not exists public.templates (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  category_id uuid references public.categories (id) on delete set null,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);

create table if not exists public.template_fields (
  id               uuid primary key default gen_random_uuid(),
  template_id      uuid not null references public.templates (id) on delete cascade,
  field_key        text not null,
  label            text not null,
  field_kind       text not null default 'source' check (field_kind in ('source', 'user')),
  owner_role_code  text references public.role_definitions (role_code) on delete set null,
  owner_profile_id uuid references public.profiles (id) on delete cascade,
  input_type       text not null default 'text' check (input_type in ('text', 'textarea', 'number', 'date', 'dropdown')),
  options          jsonb not null default '[]'::jsonb,
  is_required      boolean not null default false,
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now(),
  unique (template_id, field_key),
  check (field_kind <> 'user' or owner_role_code is not null or owner_profile_id is not null)
);

create table if not exists public.workbooks (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  category_id    uuid not null references public.categories (id) on delete restrict,
  template_id    uuid not null references public.templates (id) on delete restrict,
  status         text not null default 'active' check (status in ('active', 'ongoing', 'closed')),
  is_prioritized boolean not null default false,
  created_by     uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists public.lead_records (
  id            uuid primary key default gen_random_uuid(),
  workbook_id   uuid not null references public.workbooks (id) on delete cascade,
  row_number    integer not null,
  source_values jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  unique (workbook_id, row_number)
);

create table if not exists public.lead_assignments (
  id           uuid primary key default gen_random_uuid(),
  lead_id      uuid not null references public.lead_records (id) on delete cascade,
  assigned_to  uuid not null references public.profiles (id) on delete cascade,
  assigned_by  uuid references public.profiles (id) on delete set null,
  role_code    text not null references public.role_definitions (role_code),
  status       text not null default 'assigned' check (status in ('assigned', 'completed')),
  assigned_at  timestamptz not null default now(),
  completed_at timestamptz,
  unique (lead_id, assigned_to)
);

create table if not exists public.assignment_field_values (
  id            uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.lead_assignments (id) on delete cascade,
  field_id      uuid not null references public.template_fields (id) on delete cascade,
  value         jsonb,
  updated_by    uuid references public.profiles (id) on delete set null,
  updated_at    timestamptz not null default now(),
  unique (assignment_id, field_id)
);

create table if not exists public.notification_outbox (
  id              uuid primary key default gen_random_uuid(),
  recipient_id    uuid references public.profiles (id) on delete cascade,
  recipient_email text not null,
  subject         text not null,
  body            text not null,
  delivery_status text not null default 'pending' check (delivery_status in ('pending', 'sent', 'failed')),
  created_at      timestamptz not null default now(),
  sent_at         timestamptz
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

create unique index if not exists categories_name_lower_idx on public.categories (lower(name));
create unique index if not exists templates_name_category_idx
  on public.templates (lower(name), coalesce(category_id, '00000000-0000-0000-0000-000000000000'::uuid));

create index if not exists profiles_role_idx on public.profiles (role_code);
create index if not exists profiles_manager_idx on public.profiles (manager_id);
create index if not exists profile_managers_manager_idx on public.profile_managers (manager_id);
create index if not exists template_fields_template_idx on public.template_fields (template_id, sort_order);
create index if not exists template_fields_owner_profile_idx on public.template_fields (owner_profile_id);
create index if not exists workbooks_category_idx on public.workbooks (category_id);
create index if not exists workbooks_template_idx on public.workbooks (template_id);
create index if not exists workbooks_status_idx on public.workbooks (status);
create index if not exists lead_records_workbook_idx on public.lead_records (workbook_id, row_number);
create index if not exists lead_assignments_lead_idx on public.lead_assignments (lead_id);
create index if not exists lead_assignments_assignee_idx on public.lead_assignments (assigned_to);
create index if not exists lead_assignments_status_idx on public.lead_assignments (status);
create index if not exists assignment_field_values_assignment_idx on public.assignment_field_values (assignment_id);
create index if not exists assignment_field_values_field_idx on public.assignment_field_values (field_id);
create index if not exists notification_outbox_status_idx on public.notification_outbox (delivery_status, created_at);

-- ---------------------------------------------------------------------------
-- updated_at helper
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $crm$
begin
  new.updated_at = now();
  return new;
end;
$crm$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists workbooks_set_updated_at on public.workbooks;
create trigger workbooks_set_updated_at
  before update on public.workbooks
  for each row execute function public.set_updated_at();

drop trigger if exists assignment_field_values_set_updated_at on public.assignment_field_values;
create trigger assignment_field_values_set_updated_at
  before update on public.assignment_field_values
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Seed roles
-- ---------------------------------------------------------------------------

insert into public.role_definitions (role_code, label, is_system)
values
  ('head_office', 'Head office', true),
  ('team_member', 'Team member', false)
on conflict (role_code) do nothing;

-- ---------------------------------------------------------------------------
-- Authorization helpers (security definer avoids RLS recursion)
-- ---------------------------------------------------------------------------

create or replace function public.current_role_code()
returns text
language sql
stable
security definer
set search_path = ''
as $crm$
  select p.role_code
  from public.profiles p
  where p.id = auth.uid() and p.is_active
  limit 1;
$crm$;

create or replace function public.is_head_office()
returns boolean
language sql
stable
security definer
set search_path = ''
as $crm$
  select coalesce(public.current_role_code() = 'head_office', false);
$crm$;

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

create or replace function public.can_view_assignee(assignee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $crm$
  select assignee_id = auth.uid()
    or public.is_head_office()
    or public.is_manager_of(assignee_id);
$crm$;

create or replace function public.can_view_assignment(assignment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $crm$
  select exists (
    select 1
    from public.lead_assignments la
    where la.id = assignment_id
      and public.can_view_assignee(la.assigned_to)
  );
$crm$;

create or replace function public.can_edit_assignment_field(p_assignment_id uuid, p_field_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $crm$
  select exists (
    select 1
    from public.lead_assignments la
    join public.lead_records lr on lr.id = la.lead_id
    join public.workbooks w on w.id = lr.workbook_id
    join public.template_fields tf on tf.id = p_field_id
    where la.id = p_assignment_id
      and la.assigned_to = auth.uid()
      and la.status = 'assigned'
      and tf.template_id = w.template_id
      and tf.field_kind = 'user'
      and (
        tf.owner_profile_id = la.assigned_to
        or (tf.owner_profile_id is null and tf.owner_role_code = la.role_code)
      )
  );
$crm$;

-- ---------------------------------------------------------------------------
-- One-time head office bootstrap
-- ---------------------------------------------------------------------------

create or replace function public.crm_bootstrap_available()
returns boolean
language sql
stable
security definer
set search_path = ''
as $crm$
  select not exists (
    select 1 from public.profiles where role_code = 'head_office'
  );
$crm$;

create or replace function public.bootstrap_head_office(p_full_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $crm$
declare
  v_uid   uuid := auth.uid();
  v_email text;
  v_name  text;
begin
  if v_uid is null then
    raise exception 'You must be signed in to complete setup.';
  end if;

  if exists (select 1 from public.profiles where role_code = 'head_office') then
    raise exception 'Initial setup is already complete.';
  end if;

  select u.email,
         coalesce(
           nullif(trim(p_full_name), ''),
           nullif(trim(u.raw_user_meta_data ->> 'full_name'), ''),
           split_part(u.email, '@', 1)
         )
    into v_email, v_name
  from auth.users u
  where u.id = v_uid;

  if v_email is null then
    raise exception 'Your account could not be found.';
  end if;

  insert into public.profiles (id, email, full_name, role_code, is_active)
  values (v_uid, v_email, coalesce(v_name, 'Head office'), 'head_office', true)
  on conflict (id) do update
    set email = excluded.email,
        full_name = excluded.full_name,
        role_code = 'head_office',
        is_active = true;
end;
$crm$;

-- ---------------------------------------------------------------------------
-- Complete an assignment (validates required role fields)
-- ---------------------------------------------------------------------------

create or replace function public.complete_assignment(target_assignment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $crm$
declare
  v_uid        uuid := auth.uid();
  v_assignment public.lead_assignments%rowtype;
  v_template   uuid;
  v_missing    text;
begin
  if v_uid is null then
    raise exception 'You must be signed in.';
  end if;

  select * into v_assignment
  from public.lead_assignments
  where id = target_assignment_id
  for update;

  if not found then
    raise exception 'Assignment not found.';
  end if;

  if v_assignment.assigned_to <> v_uid then
    raise exception 'Only the assigned user can complete this work.';
  end if;

  if v_assignment.status = 'completed' then
    raise exception 'This assignment is already completed.';
  end if;

  select w.template_id into v_template
  from public.lead_records lr
  join public.workbooks w on w.id = lr.workbook_id
  where lr.id = v_assignment.lead_id;

  select string_agg(tf.label, ', ' order by tf.sort_order)
    into v_missing
  from public.template_fields tf
  where tf.template_id = v_template
    and tf.field_kind = 'user'
    and (
      tf.owner_profile_id = v_assignment.assigned_to
      or (tf.owner_profile_id is null and tf.owner_role_code = v_assignment.role_code)
    )
    and tf.is_required
    and not exists (
      select 1
      from public.assignment_field_values afv
      where afv.assignment_id = v_assignment.id
        and afv.field_id = tf.id
        and afv.value is not null
        and afv.value <> 'null'::jsonb
        and coalesce(trim(both '"' from afv.value::text), '') <> ''
    );

  if v_missing is not null then
    raise exception 'Complete the required fields before submitting: %.', v_missing;
  end if;

  update public.lead_assignments
     set status = 'completed',
         completed_at = now()
   where id = target_assignment_id;
end;
$crm$;

-- ---------------------------------------------------------------------------
-- Completion notification outbox
-- ---------------------------------------------------------------------------

create or replace function public.queue_assignment_completion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $crm$
declare
  assignee_name text;
  workbook_name text;
  lead_row      integer;
begin
  if old.status is distinct from 'completed' and new.status = 'completed' then
    select p.full_name into assignee_name
    from public.profiles p where p.id = new.assigned_to;

    select w.name, l.row_number into workbook_name, lead_row
    from public.lead_records l
    join public.workbooks w on w.id = l.workbook_id
    where l.id = new.lead_id;

    insert into public.notification_outbox (recipient_id, recipient_email, subject, body)
    select p.id,
      p.email,
      'Lead assignment completed',
      'Hello ' || p.full_name || E',\n\n' || coalesce(assignee_name, 'A team member') || ' completed lead #' || coalesce(lead_row::text, '-') || ' in the workbook "' || coalesce(workbook_name, 'a workbook') || '". Sign in to your CRM workspace to review the update.'
    from public.profiles p
    where p.role_code = 'head_office' and p.is_active;
  end if;
  return new;
end;
$crm$;

drop trigger if exists lead_assignment_completion_outbox on public.lead_assignments;
create trigger lead_assignment_completion_outbox
  after update of status on public.lead_assignments
  for each row execute function public.queue_assignment_completion();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.role_definitions        enable row level security;
alter table public.profiles                enable row level security;
alter table public.profile_managers        enable row level security;
alter table public.categories              enable row level security;
alter table public.templates               enable row level security;
alter table public.template_fields         enable row level security;
alter table public.workbooks               enable row level security;
alter table public.lead_records            enable row level security;
alter table public.lead_assignments        enable row level security;
alter table public.assignment_field_values enable row level security;
alter table public.notification_outbox     enable row level security;

-- role_definitions
drop policy if exists role_definitions_select on public.role_definitions;
create policy role_definitions_select on public.role_definitions
  for select to authenticated using (true);

drop policy if exists role_definitions_write on public.role_definitions;
create policy role_definitions_write on public.role_definitions
  for all to authenticated using (public.is_head_office()) with check (public.is_head_office());

-- profiles
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated using (true);

drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles
  for insert to authenticated with check (public.is_head_office());

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated using (public.is_head_office()) with check (public.is_head_office());

-- profile_managers
drop policy if exists profile_managers_select on public.profile_managers;
create policy profile_managers_select on public.profile_managers
  for select to authenticated using (true);

drop policy if exists profile_managers_write on public.profile_managers;
create policy profile_managers_write on public.profile_managers
  for all to authenticated using (public.is_head_office()) with check (public.is_head_office());

-- categories
drop policy if exists categories_select on public.categories;
create policy categories_select on public.categories
  for select to authenticated using (true);

drop policy if exists categories_write on public.categories;
create policy categories_write on public.categories
  for all to authenticated using (public.is_head_office()) with check (public.is_head_office());

-- templates
drop policy if exists templates_select on public.templates;
create policy templates_select on public.templates
  for select to authenticated using (true);

drop policy if exists templates_write on public.templates;
create policy templates_write on public.templates
  for all to authenticated using (public.is_head_office()) with check (public.is_head_office());

-- template_fields
drop policy if exists template_fields_select on public.template_fields;
create policy template_fields_select on public.template_fields
  for select to authenticated using (true);

drop policy if exists template_fields_write on public.template_fields;
create policy template_fields_write on public.template_fields
  for all to authenticated using (public.is_head_office()) with check (public.is_head_office());

-- workbooks
drop policy if exists workbooks_select on public.workbooks;
create policy workbooks_select on public.workbooks
  for select to authenticated using (
    public.is_head_office()
    or exists (
      select 1
      from public.lead_records lr
      join public.lead_assignments la on la.lead_id = lr.id
      where lr.workbook_id = workbooks.id
        and public.can_view_assignee(la.assigned_to)
    )
  );

drop policy if exists workbooks_write on public.workbooks;
create policy workbooks_write on public.workbooks
  for all to authenticated using (public.is_head_office()) with check (public.is_head_office());

-- lead_records
drop policy if exists lead_records_select on public.lead_records;
create policy lead_records_select on public.lead_records
  for select to authenticated using (
    public.is_head_office()
    or exists (
      select 1
      from public.lead_assignments la
      where la.lead_id = lead_records.id
        and public.can_view_assignee(la.assigned_to)
    )
  );

drop policy if exists lead_records_write on public.lead_records;
create policy lead_records_write on public.lead_records
  for all to authenticated using (public.is_head_office()) with check (public.is_head_office());

-- lead_assignments
drop policy if exists lead_assignments_select on public.lead_assignments;
create policy lead_assignments_select on public.lead_assignments
  for select to authenticated using (public.can_view_assignee(assigned_to));

drop policy if exists lead_assignments_write on public.lead_assignments;
create policy lead_assignments_write on public.lead_assignments
  for all to authenticated using (public.is_head_office()) with check (public.is_head_office());

-- assignment_field_values
drop policy if exists assignment_field_values_select on public.assignment_field_values;
create policy assignment_field_values_select on public.assignment_field_values
  for select to authenticated using (public.can_view_assignment(assignment_id));

drop policy if exists assignment_field_values_insert on public.assignment_field_values;
create policy assignment_field_values_insert on public.assignment_field_values
  for insert to authenticated
  with check (public.can_edit_assignment_field(assignment_id, field_id));

drop policy if exists assignment_field_values_update on public.assignment_field_values;
create policy assignment_field_values_update on public.assignment_field_values
  for update to authenticated
  using (public.can_edit_assignment_field(assignment_id, field_id))
  with check (public.can_edit_assignment_field(assignment_id, field_id));

drop policy if exists assignment_field_values_delete on public.assignment_field_values;
create policy assignment_field_values_delete on public.assignment_field_values
  for delete to authenticated using (public.is_head_office());

-- notification_outbox
drop policy if exists notification_outbox_select on public.notification_outbox;
create policy notification_outbox_select on public.notification_outbox
  for select to authenticated using (public.is_head_office() or recipient_id = auth.uid());

drop policy if exists notification_outbox_write on public.notification_outbox;
create policy notification_outbox_write on public.notification_outbox
  for all to authenticated using (public.is_head_office()) with check (public.is_head_office());

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;

grant execute on function public.crm_bootstrap_available() to anon, authenticated;
grant execute on function public.bootstrap_head_office(text) to authenticated;
grant execute on function public.complete_assignment(uuid) to authenticated;
grant execute on function public.current_role_code() to authenticated;
grant execute on function public.is_head_office() to authenticated;
grant execute on function public.is_manager_of(uuid) to authenticated;
grant execute on function public.can_view_assignee(uuid) to authenticated;
grant execute on function public.can_view_assignment(uuid) to authenticated;
grant execute on function public.can_edit_assignment_field(uuid, uuid) to authenticated;
