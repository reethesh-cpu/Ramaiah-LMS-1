import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { refreshAccessToken, isGmailConfigured } from '@/lib/notifications/gmail-oauth'
import { sendWithGoogleMailApi } from '@/lib/notifications/gmail-api'

const LMS_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://ramaiahlms.vercel.app'

function buildUpdateEmail(senderName: string, workbookName: string, recipientName: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">
        <tr><td style="background:#c8102e;padding:24px 32px;">
          <div style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:.5px;">Ramaiah Capital LMS</div>
        </td></tr>
        <tr><td style="padding:32px;">
          <p style="margin:0 0 8px;font-size:16px;color:#111;">Hello <strong>${recipientName}</strong>,</p>
          <p style="margin:0 0 24px;font-size:14px;color:#444;line-height:1.6;">
            <strong style="color:#c8102e;">${senderName}</strong> has updated their columns in the workbook
            <strong style="color:#c8102e;">${workbookName}</strong>.
            Please sign in to review the latest changes.
          </p>
          <table cellpadding="0" cellspacing="0"><tr><td style="border-radius:6px;background:#c8102e;">
            <a href="${LMS_URL}/admin" target="_blank"
               style="display:inline-block;padding:12px 28px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px;">
              Open LMS Workspace
            </a>
          </td></tr></table>
          <p style="margin:24px 0 0;font-size:12px;color:#888;">
            This notification was sent from the Ramaiah Capital CRM. If you did not expect this, please contact your administrator.
          </p>
        </td></tr>
        <tr><td style="background:#f4f4f5;padding:16px 32px;font-size:11px;color:#aaa;text-align:center;">
          © Ramaiah Capital &nbsp;·&nbsp; <a href="${LMS_URL}" style="color:#c8102e;text-decoration:none;">ramaiahlms.vercel.app</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

// POST /api/notifications/notify-manager
// Called by workspace users to notify the next reporting level in the
// workbook's flow and the head office admins that they have updated their
// columns. There is no per-person manager fallback: only the workbook flow
// determines who is notified.
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null) as null | { workbook_id?: string }
  const workbookId = body?.workbook_id
  if (!workbookId) return NextResponse.json({ error: 'A workbook ID is required.' }, { status: 400 })

  const admin = createAdminClient()

  // Load sender profile
  const { data: sender, error: senderError } = await admin
    .from('profiles').select('id,full_name,email,role_code').eq('id', user.id).maybeSingle()
  if (senderError || !sender) return NextResponse.json({ error: 'Your profile could not be loaded.' }, { status: 500 })

  // Load workbook name
  const { data: workbook, error: wbError } = await admin
    .from('workbooks').select('id,name').eq('id', workbookId).maybeSingle()
  if (wbError || !workbook) return NextResponse.json({ error: 'The workbook could not be found.' }, { status: 404 })

  // Notify the next role above the sender in this workbook's flow, plus every
  // head office admin. The workbook flow is the only source of reporting
  // levels, so a sender whose role is not in the flow can still reach admins.
  const recipientIdSet = new Set<string>()
  const { data: flowSteps } = await admin
    .from('workbook_reporting_steps').select('role_code,step_order').eq('workbook_id', workbookId).order('step_order')

  const senderStep = flowSteps?.find((step) => step.role_code === sender.role_code)?.step_order
  const nextStep = senderStep == null ? null : flowSteps
    ?.filter((step) => step.step_order > senderStep)
    .sort((a, b) => a.step_order - b.step_order)[0]

  if (nextStep) {
    const { data: nextPeople } = await admin
      .from('profiles').select('id').eq('role_code', nextStep.role_code).eq('is_active', true)
    for (const person of nextPeople ?? []) recipientIdSet.add(person.id)
  }

  // Head office is always copied so the admin sees every hand-off.
  const { data: admins } = await admin
    .from('profiles').select('id').eq('role_code', 'head_office').eq('is_active', true)
  for (const admin of admins ?? []) recipientIdSet.add(admin.id)

  // Remove the sender themselves in case they are head office or share the next role.
  recipientIdSet.delete(sender.id)

  if (!recipientIdSet.size) return NextResponse.json({ error: 'No next reporting level or head office account was found to notify.' }, { status: 400 })

  const { data: recipients, error: rError } = await admin
    .from('profiles').select('id,email,full_name').in('id', [...recipientIdSet]).eq('is_active', true)
  if (rError || !recipients?.length) return NextResponse.json({ error: 'Recipients could not be loaded.' }, { status: 500 })

  const rows = recipients.map((r) => ({
    recipient_id: r.id,
    recipient_email: r.email,
    subject: `Update in "${workbook.name}" from ${sender.full_name}`,
    body: buildUpdateEmail(sender.full_name, workbook.name, r.full_name),
    sender_id: sender.id,
  }))

  const { data: insertedRows, error: insertError } = await admin.from('notification_outbox').insert(rows).select('id')
  if (insertError || !insertedRows?.length) return NextResponse.json({ error: 'Notifications could not be created.' }, { status: 500 })
  const outboxIds = insertedRows.map((row) => row.id)

  // Attempt to send immediately if Gmail is configured.
  let sent = 0
  if (isGmailConfigured()) {
    // Find a fallback token from any head_office user with Gmail connected.
    let fallbackToken: string | null = null
    const { data: admins2 } = await admin
      .from('profiles').select('id,gmail_refresh_token,allow_email_sending')
      .eq('role_code', 'head_office').eq('is_active', true).not('gmail_refresh_token', 'is', null)
    for (const a of admins2 ?? []) {
      try { fallbackToken = await refreshAccessToken(a.gmail_refresh_token!); break } catch { /* try next */ }
    }

    // Also try the sender's own token.
    let senderToken: string | null = null
    const { data: senderFull } = await admin.from('profiles').select('gmail_refresh_token,allow_email_sending').eq('id', sender.id).maybeSingle()
    if (senderFull?.gmail_refresh_token && senderFull.allow_email_sending) {
      try { senderToken = await refreshAccessToken(senderFull.gmail_refresh_token) } catch { /* no token */ }
    }

    const { data: pendingRows } = await admin.from('notification_outbox')
      .select('id,recipient_email,subject,body')
      .eq('delivery_status', 'pending')
      .in('id', outboxIds)

    for (const entry of pendingRows ?? []) {
      const token = senderToken ?? fallbackToken
      if (!token) break
      try {
        await sendWithGoogleMailApi(token, { to: entry.recipient_email, subject: entry.subject, text: entry.body })
        await admin.from('notification_outbox').update({ delivery_status: 'sent', sent_at: new Date().toISOString() }).eq('id', entry.id)
        sent++
      } catch { /* leave as pending for admin to retry */ }
    }
  }

  return NextResponse.json({ notified_count: rows.length, sent, recipients: recipients.map((r) => r.full_name) }, { status: 201 })
}
