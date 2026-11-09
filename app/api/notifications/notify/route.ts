import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getHeadOfficeActor } from '@/lib/crm/server-auth'

const CHUNK = 400
const LMS_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://ramaiahlms.vercel.app'

function buildHtmlEmail(recipientName: string, workbookName: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">
        <!-- Header -->
        <tr><td style="background:#c8102e;padding:24px 32px;">
          <div style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:.5px;">Ramaiah Capital LMS</div>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:32px;">
          <p style="margin:0 0 8px;font-size:16px;color:#111;">Hello <strong>${recipientName}</strong>,</p>
          <p style="margin:0 0 24px;font-size:14px;color:#444;line-height:1.6;">
            You have leads waiting for your action in the workbook
            <strong style="color:#c8102e;">${workbookName}</strong>.
            Please open your workspace, review your assigned leads, and update the required columns.
          </p>
          <!-- CTA button -->
          <table cellpadding="0" cellspacing="0"><tr><td style="border-radius:6px;background:#c8102e;">
            <a href="${LMS_URL}/workspace" target="_blank"
               style="display:inline-block;padding:12px 28px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px;">
              Open LMS Workspace
            </a>
          </td></tr></table>
          <p style="margin:24px 0 0;font-size:12px;color:#888;">
            This notification was sent from the Ramaiah Capital CRM. If you did not expect this, please contact your administrator.
          </p>
        </td></tr>
        <!-- Footer -->
        <tr><td style="background:#f4f4f5;padding:16px 32px;font-size:11px;color:#aaa;text-align:center;">
          © Ramaiah Capital &nbsp;·&nbsp; <a href="${LMS_URL}" style="color:#c8102e;text-decoration:none;">ramaiahlms.vercel.app</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

// POST /api/notifications/notify
// Creates notification entries for every assignee in a workbook (or one specific user).
// Called by the "Notify" button on the admin workbook detail page.
export async function POST(request: Request) {
  const actor = await getHeadOfficeActor()
  if (actor.error) return NextResponse.json({ error: actor.error }, { status: actor.error === 'unauthorized' ? 401 : 403 })

  const body = await request.json().catch(() => null) as null | { workbook_id?: string; recipient_id?: string }
  const workbookId = body?.workbook_id
  const recipientId = body?.recipient_id // optional: notify only this one user
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

  let assigneeIds = [...new Set((rawAssignments ?? []).map((a) => a.assigned_to).filter(Boolean))]
  if (!assigneeIds.length) return NextResponse.json({ error: 'No team members are assigned to this workbook yet.' }, { status: 400 })

  // If a specific recipient was requested, filter to just that person.
  if (recipientId) {
    if (!assigneeIds.includes(recipientId)) return NextResponse.json({ error: 'This user is not assigned to the workbook.' }, { status: 400 })
    assigneeIds = [recipientId]
  }

  const { data: recipients, error: rError } = await admin
    .from('profiles').select('id,email,full_name').in('id', assigneeIds).eq('is_active', true)
  if (rError || !recipients?.length) return NextResponse.json({ error: 'No active assignees found.' }, { status: 400 })

  const rows = recipients.map((r) => ({
    recipient_id: r.id,
    recipient_email: r.email,
    subject: `Action needed: "${workbook.name}" has leads waiting for you`,
    body: buildHtmlEmail(r.full_name, workbook.name),
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
