-- Reporting flow + global user columns - part 9 (run after parts 1 to 8)
--
-- Two changes:
--   1. A workbook's reporting hierarchy is defined by an ordered role flow
--      (for example telecaller -> AGM -> HR -> CEO -> head office). Templates
--      define the default flow and every workbook copies it when it is created.
--      A workbook can then change its own flow without touching the template.
--   2. User columns belong to a person and apply to every template, instead of
--      being recreated inside each template.
--
-- Visibility rule: a person sees their own assignments plus everything below
-- their role in that workbook's flow. Head office sees everything. A role that
-- is not in the workbook's flow sees only its own assigned leads. The old
-- per-person "Reports to" links are no longer used anywhere.
--
-- Safe to run more than once in the Supabase SQL Editor.

-- ---------------------------------------------------------------------------
-- Global user columns
-- ---------------------------------------------------------------------------

-- A user column no longer has to belong to one template. Source columns still
-- belong to a template.
alter table public.template_fields
  alter column template_id drop not null;

alter table public.template_fields
  drop constraint if exists template_fields_scope_check;

alter table public.template_fields
  add constraint template_fields_scope_check
  check (field_kind = 'user' or template_id is not null);

-- One global column key per person. Template-scoped user columns keep their
-- existing per-template uniqueness.
create unique index if not exists template_fields_global_owner_key_idx
  on public.template_fields (owner_profile_id, field_key)
  where template_id is null and field_kind = 'user';

-- Move existing person columns from individual templates to "all templates".
-- If two templates already hold the same key for the same person, keep the
-- later duplicate scoped to its template so no saved value is lost.
do $$
declare
  v_field record;
begin
  for v_field in
    select id
    from public.template_fields
    where field_kind = 'user'
      and template_id is not null
    order by created_at
  loop
    begin
      update public.template_fields
         set template_id = null
       where id = v_field.id;
    exception when unique_violation then
      null;
    end;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Reporting flow tables
-- ---------------------------------------------------------------------------

create table if not exists public.template_reporting_steps (
  id          uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.templates (id) on delete cascade,
  role_code   text not null references public.role_definitions (role_code) on delete cascade,
  step_order  integer not null,
  created_at  timestamptz not null default now(),
  unique (template_id, role_code),
  unique (template_id, step_order)
);

create table if not exists public.workbook_reporting_steps (
  id          uuid primary key default gen_random_uuid(),
  workbook_id uuid not null references public.workbooks (id) on delete cascade,
  role_code   text not null references public.role_definitions (role_code) on delete cascade,
  step_order  integer not null,
  created_at  timestamptz not null default now(),
  unique (workbook_id, role_code),
  unique (workbook_id, step_order)
);

create index if not exists template_reporting_steps_template_idx
  on public.template_reporting_steps (template_id, step_order);
create index if not exists workbook_reporting_steps_workbook_idx
  on public.workbook_reporting_steps (workbook_id, step_order);

-- Give existing templates a sensible starting flow. Only roles that exist in
-- this workspace are added.
insert into public.template_reporting_steps (template_id, role_code, step_order)
select t.id, defaults.role_code, defaults.step_order
from public.templates t
cross join (
  values
    ('telecaller', 1),
    ('agm', 2),
    ('hr', 3),
    ('ceo', 4),
    ('head_office', 5)
) as defaults (role_code, step_order)
join public.role_definitions rd on rd.role_code = defaults.role_code
where not exists (
  select 1 from public.template_reporting_steps s where s.template_id = t.id
)
on conflict do nothing;

-- Copy each template's flow to the workbooks that already use it.
insert into public.workbook_reporting_steps (workbook_id, role_code, step_order)
select w.id, s.role_code, s.step_order
from public.workbooks w
join public.template_reporting_steps s on s.template_id = w.template_id
where not exists (
  select 1 from public.workbook_reporting_steps x where x.workbook_id = w.id
)
on conflict do nothing;

-- New templates start with the same default flow.
create or replace function public.seed_template_reporting_flow()
returns trigger
language plpgsql
security definer
set search_path = ''
as $crm$
begin
  insert into public.template_reporting_steps (template_id, role_code, step_order)
  select new.id, defaults.role_code, defaults.step_order
  from (
    values
      ('telecaller', 1),
      ('agm', 2),
      ('hr', 3),
      ('ceo', 4),
      ('head_office', 5)
  ) as defaults (role_code, step_order)
  join public.role_definitions rd on rd.role_code = defaults.role_code
  on conflict do nothing;
  return new;
end;
$crm$;

drop trigger if exists templates_seed_reporting_flow on public.templates;
create trigger templates_seed_reporting_flow
  after insert on public.templates
  for each row execute function public.seed_template_reporting_flow();

-- ---------------------------------------------------------------------------
-- Flow-aware visibility
-- ---------------------------------------------------------------------------

create or replace function public.workbook_role_step(p_workbook_id uuid, p_role_code text)
returns integer
language sql
stable
security definer
set search_path = ''
as $crm$
  select wrs.step_order
  from public.workbook_reporting_steps wrs
  where wrs.workbook_id = p_workbook_id
    and wrs.role_code = p_role_code
  limit 1;
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
    join public.lead_records lr on lr.id = la.lead_id
    where la.id = assignment_id
      and (
        -- Always see your own work, even if your role is not in the flow.
        la.assigned_to = auth.uid()
        -- Head office sees every column in every workbook.
        or public.is_head_office()
        -- A role sees every column below it in this workbook's flow. A role
        -- that is not in the flow has no role step, so it sees only its own.
        or (
          public.workbook_role_step(lr.workbook_id, public.current_role_code()) is not null
          and public.workbook_role_step(lr.workbook_id, public.current_role_code())
              > public.workbook_role_step(lr.workbook_id, la.role_code)
        )
      )
  );
$crm$;

create or replace function public.can_view_lead(p_lead_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $crm$
  select exists (
    select 1
    from public.lead_assignments la
    where la.lead_id = p_lead_id
      and public.can_view_assignment(la.id)
  );
$crm$;

-- ---------------------------------------------------------------------------
-- Editing and completing a person's columns (including global columns)
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
      and (tf.template_id is null or tf.template_id = w.template_id)
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
  where (tf.template_id = v_template or tf.template_id is null)
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
-- Save a flow (template or workbook) atomically
-- ---------------------------------------------------------------------------

create or replace function public.set_template_reporting_steps(p_template_id uuid, p_role_codes text[])
returns void
language plpgsql
security definer
set search_path = ''
as $crm$
begin
  if not public.is_head_office() then
    raise exception 'Only head office can change the reporting flow.';
  end if;

  if p_role_codes is not null and array_length(p_role_codes, 1) <> (
    select count(distinct item.role_code) from unnest(p_role_codes) as item (role_code)
  ) then
    raise exception 'A role can only appear once in a reporting flow.';
  end if;

  delete from public.template_reporting_steps where template_id = p_template_id;

  insert into public.template_reporting_steps (template_id, role_code, step_order)
  select p_template_id, item.role_code, item.ord
  from unnest(coalesce(p_role_codes, array[]::text[])) with ordinality as item (role_code, ord)
  where nullif(trim(item.role_code), '') is not null;
end;
$crm$;

create or replace function public.set_workbook_reporting_steps(p_workbook_id uuid, p_role_codes text[])
returns void
language plpgsql
security definer
set search_path = ''
as $crm$
begin
  if not public.is_head_office() then
    raise exception 'Only head office can change the reporting flow.';
  end if;

  if p_role_codes is not null and array_length(p_role_codes, 1) <> (
    select count(distinct item.role_code) from unnest(p_role_codes) as item (role_code)
  ) then
    raise exception 'A role can only appear once in a reporting flow.';
  end if;

  delete from public.workbook_reporting_steps where workbook_id = p_workbook_id;

  insert into public.workbook_reporting_steps (workbook_id, role_code, step_order)
  select p_workbook_id, item.role_code, item.ord
  from unnest(coalesce(p_role_codes, array[]::text[])) with ordinality as item (role_code, ord)
  where nullif(trim(item.role_code), '') is not null;
end;
$crm$;

-- ---------------------------------------------------------------------------
-- Completion notifications follow the workbook flow and copy head office
-- ---------------------------------------------------------------------------

alter table public.notification_outbox
  add column if not exists sender_id uuid references public.profiles (id) on delete set null;

create or replace function public.queue_assignment_completion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $crm$
declare
  v_assignee_name text;
  v_workbook_id   uuid;
  v_workbook_name text;
  v_lead_row      integer;
  v_step          integer;
  v_next_step     integer;
  v_subject       text;
  v_body          text;
begin
  if old.status is distinct from 'completed' and new.status = 'completed' then
    select p.full_name into v_assignee_name
    from public.profiles p where p.id = new.assigned_to;

    select w.id, w.name, l.row_number
      into v_workbook_id, v_workbook_name, v_lead_row
    from public.lead_records l
    join public.workbooks w on w.id = l.workbook_id
    where l.id = new.lead_id;

    select wrs.step_order into v_step
    from public.workbook_reporting_steps wrs
    where wrs.workbook_id = v_workbook_id
      and wrs.role_code = new.role_code;

    if v_step is not null then
      select min(wrs.step_order) into v_next_step
      from public.workbook_reporting_steps wrs
      where wrs.workbook_id = v_workbook_id
        and wrs.step_order > v_step;
    end if;

    v_subject := 'Lead assignment completed';
    v_body := 'Hello ' || coalesce(v_assignee_name, 'there') || E',\n\n'
      || coalesce(v_assignee_name, 'A team member') || ' completed lead #'
      || coalesce(v_lead_row::text, '-') || ' in the workbook "'
      || coalesce(v_workbook_name, 'a workbook')
      || '". Sign in to your CRM workspace to review the update.';

    -- Notify the next level up the workbook flow and always copy head office.
    -- A workbook without a flow, or a completion at the top of the flow, still
    -- reaches head office. The sender is never notified about their own action.
    insert into public.notification_outbox (recipient_id, recipient_email, subject, body, sender_id)
    select p.id, p.email, v_subject, v_body, new.assigned_to
    from public.profiles p
    where p.is_active
      and p.id <> new.assigned_to
      and (
        p.role_code = 'head_office'
        or (
          v_next_step is not null
          and p.role_code in (
            select wrs.role_code
            from public.workbook_reporting_steps wrs
            where wrs.workbook_id = v_workbook_id
              and wrs.step_order = v_next_step
          )
        )
      );
  end if;
  return new;
end;
$crm$;

drop trigger if exists lead_assignment_completion_outbox on public.lead_assignments;
create trigger lead_assignment_completion_outbox
  after update of status on public.lead_assignments
  for each row execute function public.queue_assignment_completion();

-- ---------------------------------------------------------------------------
-- Row Level Security for the flow tables
-- ---------------------------------------------------------------------------

alter table public.template_reporting_steps enable row level security;
alter table public.workbook_reporting_steps enable row level security;

drop policy if exists template_reporting_steps_select on public.template_reporting_steps;
create policy template_reporting_steps_select on public.template_reporting_steps
  for select to authenticated using (true);

drop policy if exists template_reporting_steps_write on public.template_reporting_steps;
create policy template_reporting_steps_write on public.template_reporting_steps
  for all to authenticated using (public.is_head_office()) with check (public.is_head_office());

drop policy if exists workbook_reporting_steps_select on public.workbook_reporting_steps;
create policy workbook_reporting_steps_select on public.workbook_reporting_steps
  for select to authenticated using (true);

drop policy if exists workbook_reporting_steps_write on public.workbook_reporting_steps;
create policy workbook_reporting_steps_write on public.workbook_reporting_steps
  for all to authenticated using (public.is_head_office()) with check (public.is_head_office());

-- Workbooks, leads, and assignments now use the flow-aware helpers.
drop policy if exists workbooks_select on public.workbooks;
create policy workbooks_select on public.workbooks
  for select to authenticated using (
    public.is_head_office()
    or exists (
      select 1
      from public.lead_records lr
      where lr.workbook_id = workbooks.id
        and public.can_view_lead(lr.id)
    )
  );

drop policy if exists lead_records_select on public.lead_records;
create policy lead_records_select on public.lead_records
  for select to authenticated using (public.can_view_lead(lead_records.id));

drop policy if exists lead_assignments_select on public.lead_assignments;
create policy lead_assignments_select on public.lead_assignments
  for select to authenticated using (public.can_view_assignment(id));

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

grant select, insert, update, delete on public.template_reporting_steps to authenticated;
grant select, insert, update, delete on public.workbook_reporting_steps to authenticated;
grant all on public.template_reporting_steps to service_role;
grant all on public.workbook_reporting_steps to service_role;

grant execute on function public.workbook_role_step(uuid, text) to authenticated;
grant execute on function public.can_view_lead(uuid) to authenticated;
grant execute on function public.set_template_reporting_steps(uuid, text[]) to authenticated;
grant execute on function public.set_workbook_reporting_steps(uuid, text[]) to authenticated;
