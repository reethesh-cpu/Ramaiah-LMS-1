import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getHeadOfficeActor } from '@/lib/crm/server-auth'

export async function POST(request: Request) {
  const actor = await getHeadOfficeActor()
  if (actor.error) return NextResponse.json({ error: actor.error }, { status: actor.error === 'unauthorized' ? 401 : 403 })
  const body = await request.json().catch(() => null) as null | { lead_ids?: string[]; assignee_ids?: string[] }
  const leadIds = [...new Set(body?.lead_ids ?? [])]
  const assigneeIds = [...new Set(body?.assignee_ids ?? [])]
  if (!leadIds.length || leadIds.length > 2000 || !assigneeIds.length || assigneeIds.length > 20) {
    return NextResponse.json({ error: 'Select at least one lead and one team member.' }, { status: 400 })
  }

  const admin = createAdminClient()
  const [{ data: leads }, { data: people }] = await Promise.all([
    admin.from('lead_records').select('id').in('id', leadIds),
    admin.from('profiles').select('id,role_code,is_active').in('id', assigneeIds),
  ])
  if ((leads ?? []).length !== leadIds.length || (people ?? []).length !== assigneeIds.length || (people ?? []).some((person) => !person.is_active)) {
    return NextResponse.json({ error: 'Some selected leads or team members are unavailable.' }, { status: 400 })
  }

  const roles = new Map((people ?? []).map((person) => [person.id, person.role_code]))
  const rows = leadIds.flatMap((lead_id) => assigneeIds.map((assigned_to) => ({ lead_id, assigned_to, assigned_by: actor.user.id, role_code: roles.get(assigned_to) })))
  for (let offset = 0; offset < rows.length; offset += 500) {
    const { error } = await admin.from('lead_assignments').insert(rows.slice(offset, offset + 500))
    if (error) return NextResponse.json({ error: 'The selected leads could not be moved. Please retry.' }, { status: 500 })
  }
  return NextResponse.json({ assigned_count: rows.length }, { status: 201 })
}
