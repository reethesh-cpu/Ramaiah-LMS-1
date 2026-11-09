'use client'

import { useEffect, useState } from 'react'
import { Check, LoaderCircle, Mail, MailCheck } from 'lucide-react'

type GmailStatus = { configured: boolean; connected: boolean; allowEmailSending: boolean } | null

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
      <div className="section-head"><div><h2>Gmail connection</h2><p>Your Gmail is the default sender. If a team member's Gmail fails, the system falls back to yours.</p></div><span className="status-pill" data-tone={status.connected ? undefined : 'neutral'}><span className="status-dot" />{status.connected ? 'Connected' : 'Not connected'}</span></div>
      <div style={{ padding: 20, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        {!status.configured
          ? <span className="form-hint">Gmail is not configured. Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET in .env.local or Vercel env vars. See docs/GMAIL_SETUP.md.</span>
          : !status.connected
            ? <button className="primary-button" onClick={connectGmail} disabled={busy}>{busy ? <LoaderCircle className="animate-spin" /> : <Mail />} Connect Gmail</button>
            : <>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}><input type="checkbox" checked={status.allowEmailSending} onChange={toggleAllowSending} disabled={busy} /><span style={{ fontWeight: 600, fontSize: 13 }}>Allow sending emails on my behalf</span></label>
              <button className="secondary-button" onClick={connectGmail} disabled={busy}><MailCheck /> Reconnect</button>
            </>
        }
      </div>
      {status.connected && status.allowEmailSending && <div className="notice" style={{ margin: '0 16px 16px' }}><Check /> You are the default sender. When a team member's Gmail is not connected or fails, the CRM sends from your Gmail address.</div>}
    </section>
  </>
}
