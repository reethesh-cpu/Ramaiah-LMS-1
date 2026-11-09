import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { exchangeCodeForTokens } from '@/lib/notifications/gmail-oauth'

// GET /api/gmail/callback?code=...&state=...
// Google redirects here after the user consents. We exchange the code for a
// refresh token and store it on the user's profile.
export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state') // user ID
  const error = url.searchParams.get('error')

  if (error) return NextResponse.redirect(new URL('/workspace?gmail_error=' + encodeURIComponent(error), url.origin))
  if (!code || !state) return NextResponse.redirect(new URL('/workspace?gmail_error=missing_code', url.origin))

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // Verify the state matches the current user to prevent CSRF.
  if (!user || user.id !== state) return NextResponse.redirect(new URL('/workspace?gmail_error=auth_mismatch', url.origin))

  const origin = url.origin
  const redirectUri = `${origin}/api/gmail/callback`

  try {
    const refreshToken = await exchangeCodeForTokens(code, redirectUri)
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ gmail_refresh_token: refreshToken })
      .eq('id', user.id)

    if (updateError) throw new Error('Could not save the Gmail connection to your profile.')

    return NextResponse.redirect(new URL('/workspace?gmail_connected=1', url.origin))
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown error'
    return NextResponse.redirect(new URL('/workspace?gmail_error=' + encodeURIComponent(msg), url.origin))
  }
}
