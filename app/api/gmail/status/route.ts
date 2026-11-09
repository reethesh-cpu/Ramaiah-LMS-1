import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isGmailConfigured } from '@/lib/notifications/gmail-oauth'

// GET /api/gmail/status — returns the current user's Gmail connection state.
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('email,gmail_refresh_token,allow_email_sending')
    .eq('id', user.id)
    .maybeSingle()

  return NextResponse.json({
    configured: isGmailConfigured(),
    connected: Boolean(profile?.gmail_refresh_token),
    connectedEmail: profile?.gmail_refresh_token ? (profile.email ?? null) : null,
    allowEmailSending: profile?.allow_email_sending ?? false,
  })
}

// PATCH /api/gmail/status — toggle the "allow sending on my behalf" setting.
export async function PATCH(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null) as null | { allow_email_sending?: boolean }
  if (body?.allow_email_sending === undefined) return NextResponse.json({ error: 'Provide allow_email_sending.' }, { status: 400 })

  const { error } = await supabase
    .from('profiles')
    .update({ allow_email_sending: body.allow_email_sending })
    .eq('id', user.id)

  if (error) return NextResponse.json({ error: 'Could not update the setting.' }, { status: 500 })
  return NextResponse.json({ allowEmailSending: body.allow_email_sending })
}

// DELETE /api/gmail/status — disconnect Gmail by clearing the refresh token.
export async function DELETE() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { error } = await supabase
    .from('profiles')
    .update({ gmail_refresh_token: null, allow_email_sending: false })
    .eq('id', user.id)

  if (error) return NextResponse.json({ error: 'Could not disconnect Gmail.' }, { status: 500 })
  return NextResponse.json({ disconnected: true })
}
