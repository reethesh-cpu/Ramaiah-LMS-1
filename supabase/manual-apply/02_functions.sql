-- Northstar CRM setup - part 2 of 4 (run parts 1 to 4 in order)

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
  with recursive chain as (
    select p.id, p.manager_id, 1 as depth
    from public.profiles p
    where p.id = target_id
    union all
    select p.id, p.manager_id, c.depth + 1
    from public.profiles p
    join chain c on p.id = c.manager_id
    where c.depth < 32
  )
  select exists (
    select 1 from chain
    where chain.id = auth.uid() and chain.id <> target_id
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
      and tf.owner_role_code = la.role_code
  );
$crm$;

-- ---------------------------------------------------------------------------
