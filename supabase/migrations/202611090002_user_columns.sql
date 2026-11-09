-- User-owned columns.
--
-- A column can belong to one specific person instead of a whole role. The owner
-- edits it from their workspace, their reporting line can see it, and head
-- office can see it in the workbook. Role-owned user columns keep working.

alter table public.template_fields
  add column if not exists owner_profile_id uuid references public.profiles (id) on delete cascade;

create index if not exists template_fields_owner_profile_idx on public.template_fields (owner_profile_id);

do $$
declare
  v_constraint text;
begin
  for v_constraint in
    select conname
    from pg_constraint
    where conrelid = 'public.template_fields'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%owner_role_code%'
      and pg_get_constraintdef(oid) like '%field_kind%'
  loop
    execute format('alter table public.template_fields drop constraint %I', v_constraint);
  end loop;
end $$;

alter table public.template_fields
  drop constraint if exists template_fields_owner_check;

alter table public.template_fields
  add constraint template_fields_owner_check
  check (field_kind <> 'user' or owner_role_code is not null or owner_profile_id is not null);

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

grant execute on function public.can_edit_assignment_field(uuid, uuid) to authenticated;

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

grant execute on function public.complete_assignment(uuid) to authenticated;
