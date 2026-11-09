import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getHeadOfficeActor } from '@/lib/crm/server-auth'

const CHUNK = 400

// POST /api/notifications/notify
// Creates notification entries for every assignee in a workbook.
// Called by the "Notify" button on the admin workbook detail page.
export async function POST(request: Request) {
  const actor = await getHeadOfficeActor()
  if (actor.error) return NextResponse.json({ error: actor.error }, { status: actor.error === 'unauthorized' ? 401 : 403 })

  const body = await request.json().catch(() => null) as null | { workbook_id?: string }
  const workbookId = body?.workbook_id
  if (!workbookId) return NextResponse.json({ error: 'A workbook ID is required.' }, { status: 400 })

  const admin = createAdminClient()

  const { data: workbook, error: wbError } = await admin
    .from('workbooks').select('id,name').eq('id', workbookId).maybeSingle()
  if (wbError || !workbook) return NextResponse.json({ error: 'The workbook could not be found.' }, { status: 404 })

  // Fetch all lead IDs for this workbook, then get distinct assignees.
  const { data: leads } = await admin
    .from('lead_records').select('id').eq('workbook_id', workbookId).range(0, 4999)

  if (!leads?.length) return NextResponse.json({ error: 'This workbook has no leads to notify about.' }, { status: 400 })

  const leadIds = leads.map((l) => l.id)
  const { data: rawAssignments, error: raError } = await admin
    .from('lead_assignments').select('assigned_to').in('lead_id', leadIds)

  if (raError) return NextResponse.json({ error: 'Assignments could not be loaded.' }, { status: 500 })

  const assigneeIds = [...new Set((rawAssignments ?? []).map((a) => a.assigned_to).filter(Boolean))]
  if (!assigneeIds.length) return NextResponse.json({ error: 'No team members are assigned to this workbook yet.' }, { status: 400 })

  const { data: recipients, error: rError } = await admin
    .from('profiles').select('id,email,full_name').in('id', assigneeIds).eq('is_active', true)
  if (rError || !recipients?.length) return NextResponse.json({ error: 'No active assignees found.' }, { status: 400 })

  const rows = recipients.map((r) => ({
    recipient_id: r.id,
    recipient_email: r.email,
    subject: `Action needed: "${workbook.name}" leads assigned to you`,
    body: `Hello ${r.full_name},\n\nYou have leads waiting in the workbook "${workbook.name}". Sign in to your CRM workspace to review and update your columns.\n\nThis is a reminder sent from the Ramaiah Capital CRM.`,
    sender_id: actor.user!.id,
  }))

  let inserted = 0
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { data, error } = await admin.from('notification_outbox').insert(rows.slice(i, i + CHUNK)).select('id')
    if (error) return NextResponse.json({ error: 'Notifications could not be created.' }, { status: 500 })
    inserted += data?.length ?? 0
  }

  return NextResponse.json({ notified_count: inserted, recipients: recipients.length }, { status: 201 })
}
