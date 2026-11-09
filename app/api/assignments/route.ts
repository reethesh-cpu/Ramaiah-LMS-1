import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getHeadOfficeActor } from '@/lib/crm/server-auth'

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
  for (let offset = 0; offset < leadIds.length; offset += CHUNK_SIZE) {
    const { data, error } = await admin.from('lead_records').select('id').in('id', leadIds.slice(offset, offset + CHUNK_SIZE))
    if (error) return NextResponse.json({ error: 'The selected leads could not be checked. Please retry.' }, { status: 500 })
    for (const row of data ?? []) foundLeadIds.add(row.id)
  }

  const { data: people, error: peopleError } = await admin.from('profiles').select('id,role_code,is_active').in('id', assigneeIds)
  if (peopleError) return NextResponse.json({ error: 'The selected team members could not be checked. Please retry.' }, { status: 500 })
  if (foundLeadIds.size !== leadIds.length || (people ?? []).length !== assigneeIds.length || (people ?? []).some((person) => !person.is_active)) {
    return NextResponse.json({ error: 'Some selected leads or team members are unavailable.' }, { status: 400 })
  }

  const roles = new Map((people ?? []).map((person) => [person.id, person.role_code]))
  const rows = leadIds.flatMap((lead_id) => assigneeIds.map((assigned_to) => ({ lead_id, assigned_to, assigned_by: actor.user.id, role_code: roles.get(assigned_to) })))

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
      await admin.from('notification_outbox').insert(notifProfiles.map((p) => ({
        recipient_id: p.id,
        recipient_email: p.email,
        subject: `New leads assigned in "${wbName}"`,
        body: `Hello ${p.full_name},\n\nYou have been assigned leads in the workbook "${wbName}". Sign in to your CRM workspace to review and work on them.`,
        sender_id: actor.user.id,
      })))
    }
  }

  return NextResponse.json({ assigned_count: assignedCount, skipped_count: rows.length - assignedCount }, { status: 201 })
}
