import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getHeadOfficeActor } from '@/lib/crm/server-auth'
import { normalizeManagerIds, replaceProfileManagers, validateManagers } from '@/lib/crm/reporting'

export async function POST(request: Request) {
  const actor = await getHeadOfficeActor()
  if (actor.error) return NextResponse.json({ error: actor.error }, { status: actor.error === 'unauthorized' ? 401 : 403 })

  const body = await request.json().catch(() => null) as null | { full_name?: string; email?: string; password?: string; role_code?: string; manager_id?: string | null; manager_ids?: unknown }
  const fullName = body?.full_name?.trim()
  const email = body?.email?.trim().toLowerCase()
  const password = body?.password
  const roleCode = body?.role_code
  const requestedManagers = normalizeManagerIds(body?.manager_ids ?? body?.manager_id)

  if (!fullName || fullName.length > 120 || !email || email.length > 254 || !/^\S+@\S+\.\S+$/.test(email) || !password || password.length < 8 || password.length > 128 || !roleCode) {
    return NextResponse.json({ error: 'Enter a valid name, email, role, and password of at least 8 characters.' }, { status: 400 })
  }

  const admin = createAdminClient()
  const [{ data: role }, managers] = await Promise.all([
    admin.from('role_definitions').select('role_code').eq('role_code', roleCode).maybeSingle(),
    validateManagers(admin, requestedManagers),
  ])
  if (!role) return NextResponse.json({ error: 'Choose an available role.' }, { status: 400 })
  if (managers.error) return NextResponse.json({ error: managers.error }, { status: 400 })

  const { data: created, error: authError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  })
  if (authError || !created.user) return NextResponse.json({ error: 'That account could not be created. Check whether the email is already in use.' }, { status: 400 })

  const { data: profile, error: profileError } = await admin.from('profiles').insert({
    id: created.user.id,
    email,
    full_name: fullName,
    role_code: roleCode,
    manager_id: managers.ids[0] ?? null,
    is_active: true,
  }).select('id,email,full_name,role_code,manager_id,is_active,created_at').single()

  if (profileError) {
    await admin.auth.admin.deleteUser(created.user.id)
    return NextResponse.json({ error: 'The user profile could not be saved.' }, { status: 500 })
  }

  const links = await replaceProfileManagers(admin, created.user.id, managers.ids)
  if (links.error) {
    await admin.auth.admin.deleteUser(created.user.id)
    return NextResponse.json({ error: links.error }, { status: 500 })
  }

  return NextResponse.json({ profile, manager_ids: managers.ids }, { status: 201 })
}
