'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FormEvent, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, CircleAlert, Layers3, LoaderCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { BrandLockup } from '@/components/brand-lockup'

export function SignInForm() {
  const router = useRouter()
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  function getSupabase() {
    if (!supabaseRef.current) supabaseRef.current = createClient()
    return supabaseRef.current
  }
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [needsConfirmation, setNeedsConfirmation] = useState(false)
  const [resending, setResending] = useState(false)
  const [pending, setPending] = useState(false)

  async function resendConfirmation() {
    setError('')
    setInfo('')
    setResending(true)

    const { error: resendError } = await getSupabase().auth.resend({
      type: 'signup',
      email: email.trim(),
      options: {
        emailRedirectTo: process.env.NEXT_PUBLIC_DEV_SUPABASE_REDIRECT_URL ?? `${window.location.origin}/auth/confirm?next=/setup`,
      },
    })

    setResending(false)
    if (resendError) {
      setError('We could not send a new confirmation email yet. Wait a minute and try again.')
      return
    }
    setInfo('A new confirmation email is on its way. Open the newest link in your inbox.')
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setInfo('')
    setNeedsConfirmation(false)
    setPending(true)

    const { error: signInError } = await getSupabase().auth.signInWithPassword({
      email: email.trim(),
      password,
    })

    if (signInError) {
      if (/not confirmed|confirm your email/i.test(signInError.message)) {
        setNeedsConfirmation(true)
        setError('This account still needs email confirmation. Open the link in your inbox, or send yourself a new one.')
        setPending(false)
        return
      }
      setError('We could not sign you in. Check your email and password, then try again.')
      setPending(false)
      return
    }

    const { data: { user } } = await getSupabase().auth.getUser()
    const { data: profile, error: profileError } = await getSupabase()
      .from('profiles')
      .select('role_code,is_active')
      .eq('id', user?.id ?? '')
      .maybeSingle()

    if (profileError || !profile) {
      const { data: bootstrapAvailable } = await getSupabase().rpc('crm_bootstrap_available')
      if (bootstrapAvailable) {
        router.replace('/setup')
      } else {
        await getSupabase().auth.signOut()
        setError('This account is not active in the workspace. Contact your head office administrator.')
        setPending(false)
      }
      return
    }

    if (!profile.is_active) {
      await getSupabase().auth.signOut()
      setError('This account is not active in the workspace. Contact your head office administrator.')
      setPending(false)
      return
    }

    router.replace(profile.role_code === 'head_office' ? '/admin' : '/workspace')
    router.refresh()
  }

  return (
    <div className="auth-page">
      <section className="auth-story" aria-label="Ramaiah Capital">
        <BrandLockup />
        <div className="auth-story-copy">
          <div className="kicker" style={{ color: '#ffd9dd' }}>Your team, in sync</div>
          <h1>Work moves forward when everyone sees the next step.</h1>
          <p>One secure workspace for lead data, team activity, and decisions that keep work moving.</p>
          <div className="auth-step-list">
            <div className="auth-step"><span className="auth-step-icon"><Layers3 /></span>Flexible workbooks for the way you work</div>
            <div className="auth-step"><span className="auth-step-icon"><ArrowRight /></span>Clear ownership at every handoff</div>
          </div>
        </div>
        <div className="auth-foot">Private workspace · Supabase protected</div>
      </section>
      <section className="auth-panel">
        <div className="auth-card">
          <Link href="/" className="quiet-button" style={{ marginBottom: 28, paddingLeft: 0 }}><ArrowLeft /> Back to home</Link>
          <div className="kicker">Welcome back</div>
          <h2>Sign in to Ramaiah Capital</h2>
          <p>Use the email and password provided by your head office administrator.</p>
          <form className="auth-form" onSubmit={handleSubmit}>
            <div className="form-field">
              <label htmlFor="email">Work email</label>
              <input id="email" name="email" type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} />
            </div>
            <div className="form-field">
              <label htmlFor="password">Password</label>
              <input id="password" name="password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />
            </div>
            {error && <div className="notice" data-tone="error" role="alert"><CircleAlert />{error}</div>}
            {info && <div className="notice" role="status">{info}</div>}
            {needsConfirmation && (
              <button type="button" className="secondary-button" onClick={() => void resendConfirmation()} disabled={resending || !email.trim()}>
                {resending ? <LoaderCircle className="animate-spin" /> : null}{resending ? 'Sending…' : 'Resend confirmation email'}
              </button>
            )}
            <button className="primary-button auth-submit" type="submit" disabled={pending}>
              {pending ? <LoaderCircle className="animate-spin" /> : null}{pending ? 'Signing in…' : 'Sign in'}{!pending && <ArrowRight />}
            </button>
          </form>
          <div className="auth-helper">New organization? <Link href="/setup" style={{ color: '#c8102e', fontWeight: 650 }}>Set up the first head office account</Link></div>
        </div>
      </section>
    </div>
  )
}
