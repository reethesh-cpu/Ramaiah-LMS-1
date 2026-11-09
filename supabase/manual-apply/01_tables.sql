-- Northstar CRM setup - part 1 of 4 (run parts 1 to 4 in order)

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
  input_type       text not null default 'text' check (input_type in ('text', 'textarea', 'number', 'date', 'dropdown')),
  options          jsonb not null default '[]'::jsonb,
  is_required      boolean not null default false,
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now(),
  unique (template_id, field_key),
  check (field_kind <> 'user' or owner_role_code is not null)
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
