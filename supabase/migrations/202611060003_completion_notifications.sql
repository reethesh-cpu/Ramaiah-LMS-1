create or replace function public.queue_assignment_completion()
returns trigger
language plpgsql security definer
set search_path = ''
as $crm$
declare
  assignee_name text;
  workbook_name text;
  lead_row integer;
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
      'Hello ' || p.full_name || E',\n\n' || coalesce(assignee_name, 'A team member') || ' completed lead #' || coalesce(lead_row::text, '—') || ' in the workbook "' || coalesce(workbook_name, 'a workbook') || '". Sign in to your CRM workspace to review the update.'
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
