import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getHeadOfficeActor } from '@/lib/crm/server-auth'
import { refreshAccessToken, isGmailConfigured, getGmailCredentials } from '@/lib/notifications/gmail-oauth'
import { sendWithGoogleMailApi } from '@/lib/notifications/gmail-api'

// POST /api/notifications/send
// Processes pending notifications in the outbox.
// For each entry: try the sender's Gmail (if connected and opted in),
// then fall back to the first head-office user's Gmail,
// then give up and mark as failed.
export async function POST() {
  const actor = await getHeadOfficeActor()
  if (actor.error) return NextResponse.json({ error: actor.error }, { status: actor.error === 'unauthorized' ? 401 : 403 })

  if (!isGmailConfigured()) return NextResponse.json({ error: 'Gmail OAuth is not configured. Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET in .env.local and connect at least one Gmail account.' }, { status: 400 })

  const admin = createAdminClient()

  // Fetch pending notifications with sender info.
  const { data: pending, error } = await admin
    .from('notification_outbox')
    .select('id,recipient_email,subject,body,sender_id')
    .eq('delivery_status', 'pending')
    .order('created_at', { ascending: true })
    .range(0, 49)

  if (error) return NextResponse.json({ error: 'The outbox could not be read.' }, { status: 500 })
  if (!pending?.length) return NextResponse.json({ sent: 0, failed: 0, message: 'No pending notifications.' })

  // Mark any legacy plain-text notifications (no DOCTYPE) as sent without
  // delivering them, so they don't appear as duplicate lead-level emails.
  const legacyIds = (pending ?? []).filter((e) => !e.body?.includes('<!DOCTYPE')).map((e) => e.id)
  if (legacyIds.length) {
    await admin.from('notification_outbox').update({ delivery_status: 'sent', sent_at: new Date().toISOString() }).in('id', legacyIds)
  }
  const htmlPending = (pending ?? []).filter((e) => e.body?.includes('<!DOCTYPE'))

  // Cache sender profiles and access tokens to avoid repeated lookups.
  const profileCache = new Map<string, { gmail_refresh_token: string | null; allow_email_sending: boolean } | null>()
  const tokenCache = new Map<string, string>() // profileId -> access token (or '' for none)

  async function getProfile(userId: string | null) {
    if (!userId) return null
    if (profileCache.has(userId)) return profileCache.get(userId) ?? null
    const { data } = await admin.from('profiles').select('gmail_refresh_token,allow_email_sending').eq('id', userId).maybeSingle()
    const profile = data ?? null
    profileCache.set(userId, profile)
    return profile
  }

  async function getAccessToken(userId: string | null) {
    if (!userId) return null
    if (tokenCache.has(userId)) {
      const cached = tokenCache.get(userId)!
      return cached || null
    }
    const profile = await getProfile(userId)
    if (!profile?.gmail_refresh_token || !profile.allow_email_sending) {
      tokenCache.set(userId, '')
      return null
    }
    try {
      const token = await refreshAccessToken(profile.gmail_refresh_token)
      tokenCache.set(userId, token)
      return token
    } catch {
      tokenCache.set(userId, '')
      return null
    }
  }

  // Find a fallback head-office sender.
  let fallbackToken: string | null = null
  let fallbackFetched = false
  async function getFallbackToken() {
    if (fallbackFetched) return fallbackToken
    fallbackFetched = true
    const { data: admins } = await admin
      .from('profiles')
      .select('id,gmail_refresh_token,allow_email_sending')
      .eq('role_code', 'head_office')
      .eq('is_active', true)
      .not('gmail_refresh_token', 'is', null)
    for (const a of admins ?? []) {
      try {
        fallbackToken = await refreshAccessToken(a.gmail_refresh_token!)
        return fallbackToken
      } catch { /* try next admin */ }
    }
    return null
  }

  let sent = 0
  let failed = 0

  for (const entry of htmlPending) {
    let token = await getAccessToken(entry.sender_id)
    if (!token) token = await getFallbackToken()
    if (!token) {
      await admin.from('notification_outbox').update({ delivery_status: 'failed' }).eq('id', entry.id)
      failed++
      continue
    }
    try {
      await sendWithGoogleMailApi(token, { to: entry.recipient_email, subject: entry.subject, text: entry.body })
      await admin.from('notification_outbox').update({ delivery_status: 'sent', sent_at: new Date().toISOString() }).eq('id', entry.id)
      sent++
    } catch {
      // If the sender's token failed, try the fallback before giving up.
      if (entry.sender_id) {
        const fb = await getFallbackToken()
        if (fb && fb !== token) {
          try {
            await sendWithGoogleMailApi(fb, { to: entry.recipient_email, subject: entry.subject, text: entry.body })
            await admin.from('notification_outbox').update({ delivery_status: 'sent', sent_at: new Date().toISOString() }).eq('id', entry.id)
            sent++
            continue
          } catch { /* fall through to failed */ }
        }
      }
      await admin.from('notification_outbox').update({ delivery_status: 'failed' }).eq('id', entry.id)
      failed++
    }
  }

  return NextResponse.json({ sent, failed })
}
