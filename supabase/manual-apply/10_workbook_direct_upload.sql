-- Direct workbook upload - part 10 (run after parts 1 to 9)
--
-- Removes the need to pre-create a template before importing a workbook.
-- An uploaded Excel/CSV file becomes the workbook's source columns directly.
-- Existing template-based workbooks continue to work unchanged.
--
-- Safe to run more than once in the Supabase SQL Editor.

-- ---------------------------------------------------------------------------
-- Workbooks no longer require a template
-- ---------------------------------------------------------------------------

alter table public.workbooks
  alter column template_id drop not null;

-- ---------------------------------------------------------------------------
-- Source fields can belong to a workbook (direct upload) or a template (legacy)
-- ---------------------------------------------------------------------------

alter table public.template_fields
  add column if not exists workbook_id uuid references public.workbooks (id) on delete cascade;

create index if not exists template_fields_workbook_idx
  on public.template_fields (workbook_id, sort_order);

alter table public.template_fields
  drop constraint if exists template_fields_scope_check;

alter table public.template_fields
  add constraint template_fields_scope_check
  check (
    (field_kind = 'source' and (template_id is not null or workbook_id is not null))
    or (field_kind = 'user')
  );

-- One field key per workbook. Template-scoped keys are already unique via the
-- table's original unique(template_id, field_key) constraint.
create unique index if not exists template_fields_workbook_key_idx
  on public.template_fields (workbook_id, field_key)
  where workbook_id is not null;

-- ---------------------------------------------------------------------------
-- Field editing/completion must recognise workbook-owned source/user fields
-- ---------------------------------------------------------------------------

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
      and la.status in ('assigned', 'completed')
      and (
        tf.workbook_id = w.id
        or (tf.workbook_id is null and (tf.template_id is null or tf.template_id = w.template_id))
      )
      and tf.field_kind = 'user'
      and (
        tf.owner_profile_id = la.assigned_to
        or (tf.owner_profile_id is null and tf.owner_role_code = la.role_code)
      )
  );
$crm$;

create or replace function public.complete_assignment(target_assignment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $crm$
declare
  v_uid        uuid := auth.uid();
  v_assignment public.lead_assignments%rowtype;
  v_workbook   uuid;
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

  select w.id, w.template_id into v_workbook, v_template
  from public.lead_records lr
  join public.workbooks w on w.id = lr.workbook_id
  where lr.id = v_assignment.lead_id;

  select string_agg(tf.label, ', ' order by tf.sort_order)
    into v_missing
  from public.template_fields tf
  where (
      tf.workbook_id = v_workbook
      or (tf.workbook_id is null and (tf.template_id is null or tf.template_id = v_template))
    )
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

grant execute on function public.can_edit_assignment_field(uuid, uuid) to authenticated;
grant execute on function public.complete_assignment(uuid) to authenticated;

-- template_fields_select remains readable by authenticated users (as in 04).
-- Head office manages writes; this keeps backward compatibility.
drop policy if exists template_fields_select on public.template_fields;
create policy template_fields_select on public.template_fields
  for select to authenticated using (true);
