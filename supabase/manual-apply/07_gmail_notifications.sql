-- Gmail notifications - manual apply (run after parts 1 to 6)
-- Adds per-user Gmail settings and a sender column on the outbox.

-- Add Gmail columns to profiles (safe to re-run).
alter table public.profiles
  add column if not exists gmail_refresh_token text,
  add column if not exists allow_email_sending boolean not null default false;

-- Track which user's Gmail should send each notification.
alter table public.notification_outbox
  add column if not exists sender_id uuid references public.profiles (id) on delete set null;

-- Allow users to update their own Gmail columns.
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated
  using (auth.uid() = id or public.is_head_office())
  with check (auth.uid() = id or public.is_head_office());

-- Update the completion trigger to record the sender.
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

    insert into public.notification_outbox (recipient_id, recipient_email, subject, body, sender_id)
    select p.id,
      p.email,
      'Lead assignment completed',
      'Hello ' || p.full_name || E',\n\n' || coalesce(assignee_name, 'A team member') || ' completed lead #' || coalesce(lead_row::text, '—') || ' in the workbook "' || coalesce(workbook_name, 'a workbook') || '". Sign in to your CRM workspace to review the update.',
      new.assigned_to
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
