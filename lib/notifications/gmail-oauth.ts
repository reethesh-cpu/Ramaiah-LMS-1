import 'server-only'

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const SCOPE = 'https://www.googleapis.com/auth/gmail.send'

export function getGmailCredentials() {
  const clientId = process.env.GMAIL_CLIENT_ID
  const clientSecret = process.env.GMAIL_CLIENT_SECRET
  if (!clientId || !clientSecret) return null
  return { clientId, clientSecret }
}

export function isGmailConfigured() {
  return getGmailCredentials() !== null
}

export function generateAuthUrl(redirectUri: string, state: string) {
  const creds = getGmailCredentials()
  if (!creds) throw new Error('Gmail OAuth is not configured. Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET.')
  const params = new URLSearchParams({
    client_id: creds.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    state,
  })
  return `${AUTH_URL}?${params.toString()}`
}

export async function exchangeCodeForTokens(code: string, redirectUri: string) {
  const creds = getGmailCredentials()
  if (!creds) throw new Error('Gmail OAuth is not configured.')
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
    cache: 'no-store',
  })
  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Google rejected the authorization code: ${error}`)
  }
  const data = await response.json() as { refresh_token?: string; access_token?: string }
  if (!data.refresh_token) throw new Error('Google did not return a refresh token. Revoke access in your Google account settings and try again.')
  return data.refresh_token
}

export async function refreshAccessToken(refreshToken: string): Promise<string> {
  const creds = getGmailCredentials()
  if (!creds) throw new Error('Gmail OAuth is not configured.')
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
    cache: 'no-store',
  })
  if (!response.ok) throw new Error('Gmail access token could not be refreshed.')
  const data = await response.json() as { access_token?: string }
  if (!data.access_token) throw new Error('Gmail did not return an access token.')
  return data.access_token
}
