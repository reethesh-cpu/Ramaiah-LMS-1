'use client'

import Link from 'next/link'
import { type FormEvent, useState } from 'react'
import useSWR from 'swr'
import { useRouter } from 'next/navigation'
import { ArrowLeft, CircleAlert, Layers3, LoaderCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

export function SetupForm() {
  const router = useRouter()
  const supabase = createClient()
  const { data: setupStatus, error: setupStatusError, isLoading: checkingSetup } = useSWR('crm-setup-state', async () => {
    const [{ data: { user } }, { data: available, error }] = await Promise.all([
      supabase.auth.getUser(),
      supabase.rpc('crm_bootstrap_available'),
    ])
    if (error) throw error
    return { user, available: Boolean(available) }
  }, { revalidateOnFocus: false })
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  async function finishSetup(name: string) {
    const { error: bootstrapError } = await supabase.rpc('bootstrap_head_office', { p_full_name: name })
    if (bootstrapError) {
      setError(bootstrapError.message.includes('already complete')
        ? 'Initial setup has already been completed.'
        : 'We could not complete setup for this account. Confirm the workspace is still awaiting its first administrator.')
      return false
    }
    router.replace('/admin')
    router.refresh()
    return true
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setMessage('')
    setPending(true)

    const existingUser = setupStatus?.user
    if (setupStatusError || !setupStatus?.available) {
      setError('Initial setup has already been completed or is unavailable.')
      setPending(false)
      return
    }

    const savedName = typeof existingUser?.user_metadata?.full_name === 'string'
      ? existingUser.user_metadata.full_name
      : ''
    const name = fullName.trim() || savedName
    if (existingUser) {
      await finishSetup(name)
      setPending(false)
      return
    }

    const { data, error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        emailRedirectTo: process.env.NEXT_PUBLIC_DEV_SUPABASE_REDIRECT_URL ?? `${window.location.origin}/auth/confirm?next=/setup`,
        data: { full_name: fullName.trim() },
      },
    })

    if (signUpError) {
      setError('The first account could not be created. Check the details and try again.')
      setPending(false)
      return
    }

    if (data.session) {
      await finishSetup(fullName.trim())
    } else {
      setMessage('Check your inbox to confirm this account. Then return here to finish the one-time head office setup.')
    }
    setPending(false)
  }

  return (
    <div className="auth-page">
      <section className="auth-story" aria-label="Northstar CRM setup">
        <Link className="brand-lockup" href="/" aria-label="Northstar CRM home">
          <span className="brand-mark"><Layers3 size={18} /></span>
          <span className="brand-copy"><span className="brand-name">Northstar</span><span className="brand-caption">LEAD OPERATIONS</span></span>
        </Link>
        <div className="auth-story-copy">
          <div className="kicker" style={{ color: '#a9d8c9' }}>One-time organization setup</div>
          <h1>Start with a secure head office account.</h1>
          <p>The first verified account becomes the workspace owner. From there, head office can create roles, users, categories, and workbook templates.</p>
        </div>
        <div className="auth-foot">Only available before the first administrator is created.</div>
      </section>
      <section className="auth-panel">
        <div className="auth-card">
          <Link href="/" className="quiet-button" style={{ marginBottom: 28, paddingLeft: 0 }}><ArrowLeft /> Back to home</Link>
          <div className="kicker">Create your workspace</div>
          <h2>Set up head office</h2>
          <p>Create the first account for your organization. Email confirmation may be required.</p>
          {checkingSetup ? (
            <p className="auth-helper" role="status">Checking workspace setup…</p>
          ) : setupStatusError ? (
            <div className="notice" data-tone="error" role="alert">Workspace setup could not be checked. Please try again.</div>
          ) : !setupStatus?.available ? (
            <div className="notice" role="status">The first administrator is already set up. <Link href="/sign-in" style={{ fontWeight: 650 }}>Sign in</Link>.</div>
          ) : (
            <form className="auth-form" onSubmit={handleSubmit}>
              <div className="form-field"><label htmlFor="fullName">Full name</label><input id="fullName" autoComplete="name" required value={fullName || (typeof setupStatus.user?.user_metadata?.full_name === 'string' ? setupStatus.user.user_metadata.full_name : '')} onChange={(event) => setFullName(event.target.value)} /></div>
              {setupStatus.user ? <div className="notice" role="status">Signed in as {setupStatus.user.email}. Complete the one-time setup below.</div> : <>
                <div className="form-field"><label htmlFor="setupEmail">Work email</label><input id="setupEmail" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></div>
                <div className="form-field"><label htmlFor="setupPassword">Password</label><input id="setupPassword" type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} /><span className="form-hint">Use at least 8 characters.</span></div>
              </>}
              {error && <div className="notice" data-tone="error" role="alert"><CircleAlert />{error}</div>}
              {message && <div className="notice" role="status">{message}</div>}
              <button className="primary-button auth-submit" type="submit" disabled={pending}>
                {pending ? <LoaderCircle className="animate-spin" /> : null}{pending ? 'Setting up…' : setupStatus.user ? 'Finish head office setup' : 'Create head office account'}
              </button>
            </form>
          )}
          <div className="auth-helper">Already have an account? <Link href="/sign-in" style={{ color: '#347765', fontWeight: 650 }}>Sign in</Link></div>
        </div>
      </section>
    </div>
  )
}
