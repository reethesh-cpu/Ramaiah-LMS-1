import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateAuthUrl, isGmailConfigured } from '@/lib/notifications/gmail-oauth'

// GET /api/gmail/auth
// Returns the Google OAuth URL for the current user to authorize Gmail sending.
export async function GET(request: Request) {
  if (!isGmailConfigured()) return NextResponse.json({ error: 'Gmail OAuth is not configured. Ask the admin to set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET.' }, { status: 400 })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const origin = new URL(request.url).origin
  const redirectUri = `${origin}/api/gmail/callback`
  const authUrl = generateAuthUrl(redirectUri, user.id)

  return NextResponse.json({ authUrl })
}
