import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getHeadOfficeActor } from '@/lib/crm/server-auth'
import { normalizeManagerIds, replaceProfileManagers, validateManagers } from '@/lib/crm/reporting'

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getHeadOfficeActor()
  if (actor.error) return NextResponse.json({ error: actor.error }, { status: actor.error === 'unauthorized' ? 401 : 403 })
  const { id } = await params
  if (id === actor.user.id) return NextResponse.json({ error: 'You cannot deactivate or reset the signed-in head office account here.' }, { status: 400 })

  const body = await request.json().catch(() => null) as null | { is_active?: boolean; password?: string; manager_ids?: unknown }
  const hasManagerChange = body !== null && Object.prototype.hasOwnProperty.call(body, 'manager_ids')
  if (!body || (body.is_active === undefined && body.password === undefined && !hasManagerChange)) return NextResponse.json({ error: 'No supported change was provided.' }, { status: 400 })
  if (body.password !== undefined && (body.password.length < 8 || body.password.length > 128)) return NextResponse.json({ error: 'The new password must contain at least 8 characters.' }, { status: 400 })

  const admin = createAdminClient()

  if (hasManagerChange) {
    const managers = await validateManagers(admin, normalizeManagerIds(body.manager_ids), id)
    if (managers.error) return NextResponse.json({ error: managers.error }, { status: 400 })

    const { data: target } = await admin.from('profiles').select('id').eq('id', id).maybeSingle()
    if (!target) return NextResponse.json({ error: 'That person could not be found.' }, { status: 404 })

    const { error } = await admin.from('profiles').update({ manager_id: managers.ids[0] ?? null }).eq('id', id)
    if (error) return NextResponse.json({ error: 'The reporting line could not be updated.' }, { status: 500 })

    const links = await replaceProfileManagers(admin, id, managers.ids)
    if (links.error) return NextResponse.json({ error: links.error }, { status: 500 })
  }

  if (body.is_active !== undefined) {
    const { error } = await admin.from('profiles').update({ is_active: body.is_active }).eq('id', id)
    if (error) return NextResponse.json({ error: 'The account status could not be updated.' }, { status: 500 })
  }

  if (body.password !== undefined) {
    const { error } = await admin.auth.admin.updateUserById(id, { password: body.password })
    if (error) return NextResponse.json({ error: 'The password could not be reset.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
