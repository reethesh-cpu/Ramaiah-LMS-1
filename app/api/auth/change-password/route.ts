import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// POST /api/auth/change-password
// Body: { current_password: string; new_password: string }
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null) as null | { current_password?: string; new_password?: string }
  if (!body?.current_password || !body?.new_password)
    return NextResponse.json({ error: 'Both current and new password are required.' }, { status: 400 })
  if (body.new_password.length < 8)
    return NextResponse.json({ error: 'New password must be at least 8 characters.' }, { status: 400 })
  if (body.new_password === body.current_password)
    return NextResponse.json({ error: 'New password must be different from the current password.' }, { status: 400 })

  // Verify the current password by attempting to sign in with it.
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: user.email!,
    password: body.current_password,
  })
  if (signInError) return NextResponse.json({ error: 'Current password is incorrect.' }, { status: 400 })

  // Update to the new password.
  const { error: updateError } = await supabase.auth.updateUser({ password: body.new_password })
  if (updateError) return NextResponse.json({ error: 'Password could not be updated. Try again.' }, { status: 500 })

  return NextResponse.json({ ok: true })
}
