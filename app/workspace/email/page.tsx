'use client'

import { useEffect, useState } from 'react'
import { Check, LoaderCircle, Mail, MailX } from 'lucide-react'

type GmailStatus = { configured: boolean; connected: boolean; connectedEmail: string | null; allowEmailSending: boolean } | null

export default function EmailSettingsPage() {
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

  // Show loading spinner while fetching status
  if (!status) return <div className="empty-state"><LoaderCircle className="animate-spin" /></div>

  // Mandatory connect modal — shown when Gmail is configured but not connected
  const showModal = status.configured && !status.connected

  return <>
    {/* Mandatory connect modal */}
    {showModal && (
      <div style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{
          background: '#fff', borderRadius: 12, padding: '40px 36px',
          maxWidth: 420, width: '90%', boxShadow: '0 8px 32px rgba(0,0,0,.18)',
          textAlign: 'center',
        }}>
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#fde9ec', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
            <Mail size={28} color="#c8102e" />
          </div>
          <h2 style={{ margin: '0 0 10px', fontSize: 18, fontWeight: 700, color: '#1f1f23' }}>Connect your Gmail</h2>
          <p style={{ margin: '0 0 28px', fontSize: 14, color: '#6b6b73', lineHeight: 1.6 }}>
            You must connect your Gmail account before using the workspace. The CRM uses it to send assignment notifications on your behalf.
          </p>
          <button className="primary-button" style={{ width: '100%', justifyContent: 'center' }} onClick={connectGmail} disabled={busy}>
            {busy ? <LoaderCircle className="animate-spin" /> : <Mail />} Connect Gmail
          </button>
        </div>
      </div>
    )}

    <div className="page-heading"><div><div className="kicker">Workspace</div><h1>Email settings</h1><p>Connect your Gmail so the CRM can send assignment notifications on your behalf.</p></div></div>
    {notice && <div className="notice" role="status">{notice}</div>}
    <section className="card section-card">
      <div className="section-head">
        <div>
          <h2>Gmail connection</h2>
          <p>When you connect, the CRM uses your Gmail to send emails. If sending fails, it falls back to the admin's Gmail.</p>
        </div>
        <span className="status-pill" data-tone={status.connected ? undefined : 'neutral'}>
          <span className="status-dot" />{status.connected ? 'Connected' : 'Not connected'}
        </span>
      </div>
      <div style={{ padding: '16px 20px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {!status.configured ? (
          <span className="form-hint">Gmail is not configured yet. Ask the admin to add Google Mail API credentials. See docs/GMAIL_SETUP.md.</span>
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
                <div className="form-hint" style={{ marginTop: 2 }}>The CRM will send notifications from this Gmail address.</div>
              </div>
            </label>
            {/* Disconnect button */}
            <div style={{ display: 'flex', gap: 10 }}>
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
          <Check /> The CRM will send assignment notifications from <strong>{status.connectedEmail ?? 'your Gmail'}</strong>. If unavailable, the admin's Gmail is used instead.
        </div>
      )}
    </section>
  </>
}
