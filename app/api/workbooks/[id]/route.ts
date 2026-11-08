import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getHeadOfficeActor } from '@/lib/crm/server-auth'

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getHeadOfficeActor()
  if (actor.error) return NextResponse.json({ error: actor.error }, { status: actor.error === 'unauthorized' ? 401 : 403 })
  const { id } = await params
  const body = await request.json().catch(() => null) as null | { name?: string; status?: string; is_prioritized?: boolean }
  const updates: Record<string, string | boolean> = {}
  if (body?.name !== undefined) {
    const name = body.name.trim()
    if (!name || name.length > 120) return NextResponse.json({ error: 'Workbook names must be between 1 and 120 characters.' }, { status: 400 })
    updates.name = name
  }
  if (body?.status !== undefined) {
    if (!['active', 'ongoing', 'closed'].includes(body.status)) return NextResponse.json({ error: 'Choose a valid status.' }, { status: 400 })
    updates.status = body.status
  }
  if (body?.is_prioritized !== undefined) updates.is_prioritized = body.is_prioritized
  if (!Object.keys(updates).length) return NextResponse.json({ error: 'No supported change was provided.' }, { status: 400 })

  const admin = createAdminClient()
  const { data, error } = await admin.from('workbooks').update(updates).eq('id', id).select('id,name,status,is_prioritized').maybeSingle()
  if (error || !data) return NextResponse.json({ error: 'The workbook could not be updated.' }, { status: 500 })
  return NextResponse.json({ workbook: data })
}
