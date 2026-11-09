import Link from 'next/link'
import type { Metadata } from 'next'
import { ArrowLeft, CircleAlert } from 'lucide-react'
import { BrandLockup } from '@/components/brand-lockup'

export const metadata: Metadata = { title: 'Email link problem' }

const KNOWN_REASONS: Record<string, string> = {
  missing_token: 'That link did not include a confirmation token.',
  access_denied: 'The link was cancelled or has already been used.',
  otp_expired: 'That confirmation link has expired.',
  link_expired: 'That confirmation link has expired or was already used.',
}

function describe(raw: string | undefined) {
  if (!raw) return 'We could not complete the sign-in from that email link.'
  if (KNOWN_REASONS[raw]) return KNOWN_REASONS[raw]
  try {
    const text = decodeURIComponent(raw.replace(/\+/g, ' ')).replace(/_/g, ' ').trim()
    const lower = text.toLowerCase()
    if (lower.includes('code verifier')) {
      return 'This link was opened in a different browser or device from the one you signed up with. Your email may already be confirmed, so try signing in.'
    }
    if (lower.includes('already') || lower.includes('used')) return 'That link has already been used. Sign in instead.'
    if (lower.includes('expired') || lower.includes('invalid')) return 'That confirmation link has expired or is invalid.'
    return text || 'We could not complete the sign-in from that email link.'
  } catch {
    return raw.replace(/_/g, ' ').trim()
  }
}

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const raw = typeof params.reason === 'string'
    ? params.reason
    : typeof params.error_description === 'string'
      ? params.error_description
      : undefined

  return (
    <div className="auth-page">
      <section className="auth-story" aria-label="Ramaiah Capital">
        <BrandLockup />
        <div className="auth-story-copy">
          <div className="kicker" style={{ color: '#ffd9dd' }}>Sign-in link</div>
          <h1>Security links are single use.</h1>
          <p>Every confirmation link expires after a short while and can only be opened once. Requesting a new one takes a few seconds.</p>
        </div>
        <div className="auth-foot">Private workspace · Supabase protected</div>
      </section>
      <section className="auth-panel">
        <div className="auth-card">
          <Link href="/" className="quiet-button" style={{ marginBottom: 28, paddingLeft: 0 }}><ArrowLeft /> Back to home</Link>
          <div className="kicker">Email link</div>
          <h2>We could not verify that link</h2>
          <div className="notice" data-tone="error" role="alert"><CircleAlert />{describe(raw)}</div>
          <p className="auth-helper">
            Open the newest confirmation email in the same browser you signed up with. If it still fails, sign in to request a fresh link.
          </p>
          <Link className="primary-button auth-submit" href="/sign-in">Sign in</Link>
          <div className="auth-helper">Setting up the first account? <Link href="/setup" style={{ color: '#c8102e', fontWeight: 650 }}>Start workspace setup</Link>.</div>
        </div>
      </section>
    </div>
  )
}
