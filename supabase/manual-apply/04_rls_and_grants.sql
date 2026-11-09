-- Northstar CRM setup - part 4 of 4 (run parts 1 to 4 in order)

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
