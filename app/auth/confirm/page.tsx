'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, CircleAlert, Layers3, LoaderCircle } from 'lucide-react'
import type { EmailOtpType } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'

const OTP_TYPES: readonly EmailOtpType[] = ['signup', 'invite', 'magiclink', 'recovery', 'email_change', 'email']

function safeNext(raw: string | null) {
  if (!raw) return '/dashboard'
  return raw.startsWith('/') && !raw.startsWith('//') ? raw : '/dashboard'
}

function readableMessage(value: string) {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' ')).replace(/_/g, ' ').trim()
  } catch {
    return value.replace(/_/g, ' ').trim()
  }
}

function friendlyMessage(raw: string) {
  const message = readableMessage(raw)
  const lower = message.toLowerCase()
  if (lower.includes('code verifier')) {
    return 'This link was opened in a different browser or device from the one you signed up with. Your email may already be confirmed, so try signing in. To confirm from here, request a new link and open it in the same browser.'
  }
  if (lower.includes('already') || lower.includes('used')) {
    return 'This link has already been used. Sign in with your email and password instead.'
  }
  if (lower.includes('expired') || lower.includes('invalid') || lower.includes('not found')) {
    return 'This confirmation link has expired or is invalid. Sign in to request a fresh one.'
  }
  return message || 'The confirmation link is invalid or has expired.'
}

/**
 * Handles every shape a Supabase auth email link can arrive in:
 * - `?token_hash=...&type=...`  (email templates that use `{{ .TokenHash }}`)
 * - `?code=...`                 (PKCE flow used by @supabase/ssr)
 * - `#access_token=...`         (implicit flow)
 * - `?error=...`                (GoTrue reported a failure)
 *
 * Doing this in the browser means the PKCE code verifier cookie is available,
 * and any failure shows a friendly page instead of a 404.
 */
export default function ConfirmEmailPage() {
  const router = useRouter()
  const started = useRef(false)
  const [tone, setTone] = useState<'working' | 'error'>('working')
  const [detail, setDetail] = useState('')

  useEffect(() => {
    if (started.current) return
    started.current = true

    const supabase = createClient()
    const url = new URL(window.location.href)

    function finish() {
      router.replace(safeNext(url.searchParams.get('next')))
      router.refresh()
    }

    function fail(message: string) {
      setTone('error')
      setDetail(message)
    }

    async function run() {
      const params = url.searchParams

      const reported = params.get('error_description') ?? params.get('error')
      if (reported) {
        fail(friendlyMessage(reported))
        return
      }

      // Implicit flow: tokens are in the URL fragment, which the server never sees.
      if (url.hash.length > 1) {
        const hash = new URLSearchParams(url.hash.slice(1))
        const accessToken = hash.get('access_token')
        const refreshToken = hash.get('refresh_token')
        if (accessToken && refreshToken) {
          const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
          if (error) {
            fail(friendlyMessage(error.message))
            return
          }
          finish()
          return
        }
      }

      // Email template using {{ .TokenHash }}.
      const tokenHash = params.get('token_hash')
      const type = OTP_TYPES.find((item) => item === params.get('type'))
      if (tokenHash && type) {
        const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
        if (error) {
          fail(friendlyMessage(error.message))
          return
        }
        finish()
        return
      }

      // Default GoTrue + @supabase/ssr PKCE flow.
      const code = params.get('code')
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        if (error) {
          fail(friendlyMessage(error.message))
          return
        }
        finish()
        return
      }

      const { data: { session } } = await supabase.auth.getSession()
      if (session) {
        finish()
        return
      }

      fail('This link does not include a confirmation token.')
    }

    void run()
  }, [router])

  return (
    <div className="auth-page">
      <section className="auth-story" aria-label="Northstar CRM">
        <Link className="brand-lockup" href="/" aria-label="Northstar CRM home">
          <span className="brand-mark"><Layers3 size={18} /></span>
          <span className="brand-copy"><span className="brand-name">Northstar</span><span className="brand-caption">LEAD OPERATIONS</span></span>
        </Link>
        <div className="auth-story-copy">
          <div className="kicker" style={{ color: '#a9d8c9' }}>Email confirmation</div>
          <h1>One click and your account is ready.</h1>
          <p>We verify the link from your inbox, sign you in, and take you straight to the next step.</p>
        </div>
        <div className="auth-foot">Private workspace · Supabase protected</div>
      </section>
      <section className="auth-panel">
        <div className="auth-card">
          <Link href="/sign-in" className="quiet-button" style={{ marginBottom: 28, paddingLeft: 0 }}><ArrowLeft /> Back to sign in</Link>
          <div className="kicker">Confirmation link</div>
          <h2>{tone === 'error' ? 'That link could not be used' : 'Confirming your email'}</h2>
          {tone === 'error' ? (
            <>
              <div className="notice" data-tone="error" role="alert"><CircleAlert />{detail || 'The confirmation link is invalid or has expired.'}</div>
              <p className="auth-helper">
                Confirmation links expire and can only be used once. If you already opened this link in another browser, your email is confirmed - just sign in. Otherwise sign in to request a fresh link.
              </p>
              <Link className="primary-button auth-submit" href="/sign-in">Go to sign in</Link>
            </>
          ) : (
            <div className="notice" role="status"><LoaderCircle className="animate-spin" /> Verifying your link…</div>
          )}
          <div className="auth-helper">Need a new link? <Link href="/sign-in" style={{ color: '#347765', fontWeight: 650 }}>Sign in to resend it</Link>.</div>
        </div>
      </section>
    </div>
  )
}
