import 'server-only'

export type GmailMessage = {
  to: string
  subject: string
  text: string
}

export type GmailSendResult = { id: string }

export async function sendWithGoogleMailApi(accessToken: string, message: GmailMessage): Promise<GmailSendResult> {
  const rawMessage = [
    `To: ${message.to}`,
    `Subject: ${message.subject.replace(/[\r\n]/g, ' ')}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    '',
    message.text,
  ].join('\r\n')
  const raw = Buffer.from(rawMessage, 'utf8').toString('base64url')
  const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw }),
    cache: 'no-store',
  })
  if (!response.ok) throw new Error('Google Mail could not send the message.')
  const result = await response.json() as { id?: string }
  if (!result.id) throw new Error('Google Mail returned no message ID.')
  return { id: result.id }
}
