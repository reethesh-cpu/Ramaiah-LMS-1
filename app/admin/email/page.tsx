'use client'

import { useEffect, useState } from 'react'
import { Check, LoaderCircle, Mail, MailX } from 'lucide-react'

type GmailStatus = { configured: boolean; connected: boolean; connectedEmail: string | null; allowEmailSending: boolean } | null

export default function AdminEmailSettingsPage() {
  const [status, setStatus] = useState<GmailStatus>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    fetch('/api/gmail/status').then((r) => r.json()).then(setStatus).catch(() => {})
    const params = new URLSearchParams(window.location.search)
    if (params.get('gmail_connected')) setNotice('Gmail connected. You can now allow sending on your behalf.')
    if (params.get('gmail_error')) setNotice('Gmail connection failed: ' + params.get('gmail_error'))
  }, [])

  async function connectGmail() {
    setBusy(true)
    const res = await fetch('/api/gmail/auth')
    const data = await res.json()
    if (data.authUrl) window.location.href = data.authUrl
    else setNotice(data.error ?? 'Could not start Gmail connection.')
    setBusy(false)
  }

  async function disconnectGmail() {
    setBusy(true)
    await fetch('/api/gmail/status', { method: 'DELETE' })
    setStatus((s) => s ? { ...s, connected: false, connectedEmail: null, allowEmailSending: false } : s)
    setNotice('Gmail disconnected.')
    setBusy(false)
  }

  async function toggleAllowSending() {
    if (!status) return
    setBusy(true)
    const newValue = !status.allowEmailSending
    await fetch('/api/gmail/status', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ allow_email_sending: newValue }) })
    setStatus((s) => s ? { ...s, allowEmailSending: newValue } : s)
    setBusy(false)
  }

  if (!status) return <div className="empty-state"><LoaderCircle className="animate-spin" /></div>

  return <>
    <div className="page-heading"><div><div className="kicker">Head office</div><h1>Email settings</h1><p>Connect your Gmail. The CRM uses it as the fallback sender when team members have not connected their own.</p></div></div>
    {notice && <div className="notice" role="status">{notice}</div>}
    <section className="card section-card">
      <div className="section-head">
        <div>
          <h2>Gmail connection</h2>
          <p>Your Gmail is the default fallback sender. If a team member's Gmail fails or is not connected, the system uses yours.</p>
        </div>
        <span className="status-pill" data-tone={status.connected ? undefined : 'neutral'}>
          <span className="status-dot" />{status.connected ? 'Connected' : 'Not connected'}
        </span>
      </div>
      <div style={{ padding: '16px 20px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {!status.configured ? (
          <span className="form-hint">Gmail is not configured. Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET in Vercel env vars. See docs/GMAIL_SETUP.md.</span>
        ) : status.connected ? (
          <>
            {/* Connected email display */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: '#f5f5f6', borderRadius: 8, border: '1px solid var(--border)' }}>
              <Mail size={16} color="#c8102e" />
              <span style={{ fontSize: 13, fontWeight: 600, color: '#1f1f23' }}>{status.connectedEmail ?? 'Your Gmail account'}</span>
              <span className="status-pill" style={{ marginLeft: 'auto' }}><span className="status-dot" />Connected</span>
            </div>
            {/* Allow sending toggle */}
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '10px 14px', background: '#fff', borderRadius: 8, border: '1px solid var(--border)' }}>
              <input type="checkbox" checked={status.allowEmailSending} onChange={toggleAllowSending} disabled={busy} />
              <div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>Allow sending emails on my behalf</div>
                <div className="form-hint" style={{ marginTop: 2 }}>The CRM uses this Gmail as the fallback sender for the whole team.</div>
              </div>
            </label>
            {/* Disconnect button */}
            <div>
              <button className="secondary-button" onClick={disconnectGmail} disabled={busy} style={{ color: '#b34c4c', borderColor: '#e8c5c5' }}>
                {busy ? <LoaderCircle className="animate-spin" /> : <MailX size={15} />} Disconnect
              </button>
            </div>
          </>
        ) : (
          <button className="primary-button" onClick={connectGmail} disabled={busy}>
            {busy ? <LoaderCircle className="animate-spin" /> : <Mail />} Connect Gmail
          </button>
        )}
      </div>
      {status.connected && status.allowEmailSending && (
        <div className="notice" style={{ margin: '0 16px 16px' }}>
          <Check /> You are the fallback sender. Emails go from <strong>{status.connectedEmail ?? 'your Gmail'}</strong> when a team member's Gmail is unavailable.
        </div>
      )}
    </section>
  </>
}
