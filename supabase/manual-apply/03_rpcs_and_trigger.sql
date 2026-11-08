-- Northstar CRM setup - part 3 of 4 (run parts 1 to 4 in order)

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
    and tf.owner_role_code = v_assignment.role_code
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
