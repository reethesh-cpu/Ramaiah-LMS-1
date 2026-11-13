import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getHeadOfficeActor } from '@/lib/crm/server-auth'
import { mergeFlowRoles } from '@/lib/crm/reporting-flow'

// PostgREST puts filters in the URL, so a request with 5,000 UUIDs is far too
// long. Every lookup and write below is chunked to stay well under the limit.
const CHUNK_SIZE = 400

export async function POST(request: Request) {
  const actor = await getHeadOfficeActor()
  if (actor.error) return NextResponse.json({ error: actor.error }, { status: actor.error === 'unauthorized' ? 401 : 403 })
  const body = await request.json().catch(() => null) as null | { lead_ids?: string[]; assignee_ids?: string[] }
  const leadIds = [...new Set(body?.lead_ids ?? [])]
  const assigneeIds = [...new Set(body?.assignee_ids ?? [])]
  if (!leadIds.length || leadIds.length > 5000 || !assigneeIds.length || assigneeIds.length > 20) {
    return NextResponse.json({ error: 'Select at least one lead and one team member.' }, { status: 400 })
  }

  const admin = createAdminClient()

  const foundLeadIds = new Set<string>()
  const leadWorkbooks = new Map<string, string>()
  for (let offset = 0; offset < leadIds.length; offset += CHUNK_SIZE) {
    const { data, error } = await admin.from('lead_records').select('id,workbook_id').in('id', leadIds.slice(offset, offset + CHUNK_SIZE))
    if (error) return NextResponse.json({ error: 'The selected leads could not be checked. Please retry.' }, { status: 500 })
    for (const row of data ?? []) {
      foundLeadIds.add(row.id)
      leadWorkbooks.set(row.id, row.workbook_id)
    }
  }

  const { data: people, error: peopleError } = await admin.from('profiles').select('id,role_code,is_active').in('id', assigneeIds)
  if (peopleError) return NextResponse.json({ error: 'The selected team members could not be checked. Please retry.' }, { status: 500 })
  if (foundLeadIds.size !== leadIds.length || (people ?? []).length !== assigneeIds.length || (people ?? []).some((person) => !person.is_active)) {
    return NextResponse.json({ error: 'Some selected leads or team members are unavailable.' }, { status: 400 })
  }

  const roles = new Map((people ?? []).map((person) => [person.id, person.role_code]))
  const rows = leadIds.flatMap((lead_id) => assigneeIds.map((assigned_to) => ({ lead_id, assigned_to, assigned_by: actor.user.id, role_code: roles.get(assigned_to) })))

  // If a workbook already has a reporting flow, a newly assigned person's role
  // must appear in it. Otherwise nobody above them would see their column.
  const workbookIds = [...new Set(leadWorkbooks.values())]
  const { data: flowSteps } = await admin
    .from('workbook_reporting_steps').select('workbook_id,role_code,step_order').in('workbook_id', workbookIds)
  const assignedRoleCodes = [...new Set(rows.map((row) => row.role_code))]
  for (const workbookId of workbookIds) {
    const existing = (flowSteps ?? [])
      .filter((step) => step.workbook_id === workbookId)
      .sort((a, b) => a.step_order - b.step_order)
      .map((step) => step.role_code)
    // Workbooks without a flow only show leads to assigned people and head office.
    if (!existing.length) continue
    const merged = mergeFlowRoles(existing, assignedRoleCodes)
    if (merged.length === existing.length) continue
    const { error: deleteError } = await admin.from('workbook_reporting_steps').delete().eq('workbook_id', workbookId)
    if (deleteError) continue
    await admin.from('workbook_reporting_steps').insert(
      merged.map((role_code, index) => ({ workbook_id: workbookId, role_code, step_order: index + 1 })),
    )
  }

  // Re-assigning a lead to someone who already has it used to violate the
  // (lead_id, assigned_to) unique constraint. Insert with ignore-duplicates and
  // let PostgREST return only the rows that were actually created, so this can
  // be used repeatedly and we can report an accurate count.
  let assignedCount = 0
  for (let offset = 0; offset < rows.length; offset += CHUNK_SIZE) {
    const { data, error } = await admin
      .from('lead_assignments')
      .upsert(rows.slice(offset, offset + CHUNK_SIZE), { onConflict: 'lead_id,assigned_to', ignoreDuplicates: true })
      .select('id')
    if (error) return NextResponse.json({ error: 'The selected leads could not be moved. Please retry.' }, { status: 500 })
    assignedCount += (data ?? []).length
  }

  // Queue email notifications for newly assigned leads.
  if (assignedCount > 0) {
    const { data: notifProfiles } = await admin.from('profiles').select('id,email,full_name').in('id', assigneeIds).eq('is_active', true)
    if (notifProfiles?.length) {
      const { data: wbRow } = await admin.from('lead_records').select('workbooks(name)').eq('id', leadIds[0]).maybeSingle()
      const wbName = (wbRow as { workbooks?: { name?: string } } | null)?.workbooks?.name ?? 'a workbook'
      const LMS_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://ramaiahlms.vercel.app'
      await admin.from('notification_outbox').insert(notifProfiles.map((p) => ({
        recipient_id: p.id,
        recipient_email: p.email,
        subject: `New leads assigned to you in "${wbName}"`,
        body: `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/></head><body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,sans-serif;"><table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 0;"><tr><td align="center"><table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);"><tr><td style="background:#c8102e;padding:24px 32px;"><div style="color:#ffffff;font-size:20px;font-weight:700;">Ramaiah Capital LMS</div></td></tr><tr><td style="padding:32px;"><p style="margin:0 0 8px;font-size:16px;color:#111;">Hello <strong>${p.full_name}</strong>,</p><p style="margin:0 0 24px;font-size:14px;color:#444;line-height:1.6;">You have been assigned leads in the workbook <strong style="color:#c8102e;">${wbName}</strong>. Please open your workspace to review and update your columns.</p><table cellpadding="0" cellspacing="0"><tr><td style="border-radius:6px;background:#c8102e;"><a href="${LMS_URL}/workspace" target="_blank" style="display:inline-block;padding:12px 28px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px;">Open LMS Workspace</a></td></tr></table><p style="margin:24px 0 0;font-size:12px;color:#888;">This notification was sent from the Ramaiah Capital CRM.</p></td></tr><tr><td style="background:#f4f4f5;padding:16px 32px;font-size:11px;color:#aaa;text-align:center;">© Ramaiah Capital &nbsp;·&nbsp; <a href="${LMS_URL}" style="color:#c8102e;text-decoration:none;">ramaiahlms.vercel.app</a></td></tr></table></td></tr></table></body></html>`,
        sender_id: actor.user.id,
      })))
    }
  }

  return NextResponse.json({ assigned_count: assignedCount, skipped_count: rows.length - assignedCount }, { status: 201 })
}
