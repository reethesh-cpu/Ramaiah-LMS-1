import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'

const OTP_TYPES = ['signup', 'invite', 'magiclink', 'recovery', 'email_change', 'email'] as const

function safeNext(raw: string | null) {
  if (!raw) return '/dashboard'
  return raw.startsWith('/') && !raw.startsWith('//') ? raw : '/dashboard'
}

function errorRedirect(origin: string, reason: string) {
  return NextResponse.redirect(new URL(`/auth/error?reason=${encodeURIComponent(reason)}`, origin))
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl
  const next = safeNext(searchParams.get('next'))

  const reported = searchParams.get('error_description') ?? searchParams.get('error')
  if (reported) return errorRedirect(origin, reported)

  const code = searchParams.get('code')
  const tokenHash = searchParams.get('token_hash')
  const rawType = searchParams.get('type')
  const type = OTP_TYPES.find((item) => item === rawType)

  const supabase = await createClient()

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: type as EmailOtpType })
    if (!error) return NextResponse.redirect(new URL(next, origin))
    return errorRedirect(origin, error.message)
  }

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) return NextResponse.redirect(new URL(next, origin))
    return errorRedirect(origin, error.message)
  }

  const { data: { user } } = await supabase.auth.getUser()
  if (user) return NextResponse.redirect(new URL(next, origin))

  return errorRedirect(origin, 'missing_token')
}
