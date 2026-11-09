# Google Mail API Setup Guide

The CRM sends email notifications through the Gmail API using each user's own Google account (with their permission). If a user's Gmail fails, it falls back to the admin's Gmail.

---

## Step 1 — Create a Google Cloud project

1. Go to [Google Cloud Console](https://console.cloud.google.com).
2. Click the project picker at the top, then **New Project**.
3. Give it a name (e.g. `Ramaiah-CRM`) and click **Create**.
4. Select the new project.

---

## Step 2 — Enable the Gmail API

1. In the left menu go to **APIs & Services → Library**.
2. Search for **Gmail API** and click it.
3. Click **Enable**.

---

## Step 3 — Configure the OAuth consent screen

1. Go to **APIs & Services → OAuth consent screen**.
2. Choose **External** and click **Create**.
3. Fill in:
   - App name: `Ramaiah Capital CRM`
   - User support email: your admin email
   - Developer contact email: your admin email
4. Click **Save and Continue** through the Scopes step (no extra scopes needed here).
5. On the **Test users** step, add every Gmail address that will connect (while the app is in Testing mode).
6. Click **Save and Continue**, then **Back to Dashboard**.

> **Publishing:** After testing, go back to the consent screen and click **Publish App** to allow any Google account to connect, not just test users.

---

## Step 4 — Create OAuth credentials

1. Go to **APIs & Services → Credentials**.
2. Click **+ Create Credentials → OAuth client ID**.
3. Application type: **Web application**.
4. Name: `Ramaiah CRM Server`.
5. Under **Authorized redirect URIs**, add:
   - `http://localhost:3000/api/gmail/callback` (for local dev)
   - `https://your-production-domain.com/api/gmail/callback` (for production)
6. Click **Create**.
7. Copy the **Client ID** and **Client Secret**.

---

## Step 5 — Add credentials to .env.local

Open `C:\Users\reeth\Downloads\Ramaiah-LMS\.env.local` and add:

```env
GMAIL_CLIENT_ID=your-client-id-here.apps.googleusercontent.com
GMAIL_CLIENT_SECRET=your-client-secret-here
```

Restart the dev server after saving.

---

## Step 6 — Run the database migration

Paste the contents of `supabase/manual-apply/07_gmail_notifications.sql` into the Supabase SQL editor and run it. This adds the Gmail token columns and updates the notification trigger.

---

## How it works

| Step | What happens |
|------|-------------|
| Admin assigns leads | Notifications queued in `notification_outbox` |
| User completes work | Notification queued for admin |
| Admin presses **Notify assignees** | Notifications queued + sent immediately |
| Each user connects Gmail | Their refresh token stored in `profiles.gmail_refresh_token` |
| User enables **Allow sending** | `profiles.allow_email_sending = true` |
| Send runs | Uses sender's Gmail → falls back to admin Gmail → marks failed |

---

## User steps (for each team member)

1. Sign in to the CRM workspace.
2. On the **My workbooks** page, scroll to **Email settings**.
3. Click **Connect Gmail** and sign in with their Google account.
4. Check **Allow sending emails on my behalf**.

Done — the CRM will now send assignment emails from their Gmail address.
