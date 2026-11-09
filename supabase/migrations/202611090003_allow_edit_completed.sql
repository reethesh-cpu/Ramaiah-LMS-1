-- Allow users to edit their own column values after completing an assignment,
-- so they can fix or update previously submitted work.

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
      and tf.template_id = w.template_id
      and tf.field_kind = 'user'
      and (
        tf.owner_profile_id = la.assigned_to
        or (tf.owner_profile_id is null and tf.owner_role_code = la.role_code)
      )
  );
$crm$;

grant execute on function public.can_edit_assignment_field(uuid, uuid) to authenticated;
