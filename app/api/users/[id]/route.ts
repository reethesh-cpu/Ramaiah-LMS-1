import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getHeadOfficeActor } from '@/lib/crm/server-auth'

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getHeadOfficeActor()
  if (actor.error) return NextResponse.json({ error: actor.error }, { status: actor.error === 'unauthorized' ? 401 : 403 })
  const { id } = await params
  if (id === actor.user.id) return NextResponse.json({ error: 'You cannot deactivate or reset the signed-in head office account here.' }, { status: 400 })

  const body = await request.json().catch(() => null) as null | { is_active?: boolean; password?: string }
  if (!body || (body.is_active === undefined && body.password === undefined)) return NextResponse.json({ error: 'No supported change was provided.' }, { status: 400 })
  if (body.password !== undefined && (body.password.length < 8 || body.password.length > 128)) return NextResponse.json({ error: 'The new password must contain at least 8 characters.' }, { status: 400 })

  const admin = createAdminClient()

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
