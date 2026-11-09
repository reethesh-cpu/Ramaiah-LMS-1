'use client'

import { FormEvent, useState } from 'react'
import { Check, KeyRound, LoaderCircle } from 'lucide-react'

export function ChangePasswordForm() {
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(''); setNotice('')
    const form = new FormData(event.currentTarget)
    const current_password = form.get('current_password') as string
    const new_password = form.get('new_password') as string
    const confirm_password = form.get('confirm_password') as string

    if (new_password !== confirm_password) {
      setError('New password and confirmation do not match.')
      return
    }

    setSaving(true)
    const res = await fetch('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ current_password, new_password }),
    })
    const data = await res.json().catch(() => ({}))
    setSaving(false)

    if (!res.ok) { setError(data.error ?? 'Password could not be changed.'); return }
    setNotice('Password changed successfully.')
    ;(event.target as HTMLFormElement).reset()
  }

  return (
    <section className="card card-pad" style={{ maxWidth: 480 }}>
      <div className="section-head" style={{ padding: '0 0 16px', marginBottom: 18 }}>
        <div>
          <h2>Change password</h2>
          <p>Enter your current password, then choose a new one.</p>
        </div>
      </div>

      {notice && (
        <div className="notice" role="status" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Check size={15} /> {notice}
        </div>
      )}
      {error && (
        <div className="notice" data-tone="error" role="alert" style={{ marginBottom: 16 }}>
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="form-grid">
          <div className="form-field full">
            <label htmlFor="current_password">Current password</label>
            <input
              id="current_password"
              name="current_password"
              type="password"
              autoComplete="current-password"
              required
              minLength={1}
            />
          </div>
          <div className="form-field full">
            <label htmlFor="new_password">New password</label>
            <input
              id="new_password"
              name="new_password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
            />
            <span className="form-hint">At least 8 characters.</span>
          </div>
          <div className="form-field full">
            <label htmlFor="confirm_password">Confirm new password</label>
            <input
              id="confirm_password"
              name="confirm_password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
            />
          </div>
        </div>
        <div className="form-actions">
          <button className="primary-button" type="submit" disabled={saving}>
            {saving ? <LoaderCircle className="animate-spin" /> : <KeyRound />}
            {saving ? 'Saving…' : 'Update password'}
          </button>
        </div>
      </form>
    </section>
  )
}
