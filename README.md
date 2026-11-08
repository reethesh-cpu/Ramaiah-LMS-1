# Ramaiah-LMS

Northstar CRM - a Next.js + Supabase lead operations workspace.

## Local setup

1. `pnpm install`
2. Copy `.env.example` to `.env.local` and fill in the Supabase values.
3. Apply the database schema: run `supabase/manual-apply/01_tables.sql` through
   `04_rls_and_grants.sql` in order in the Supabase SQL editor, or apply
   `supabase/migrations/202611060001_initial_schema.sql` in one go.
4. `pnpm dev` → http://localhost:3000 → `/setup` to create the first head office account.

## Supabase Auth configuration

Dashboard → Authentication → URL Configuration:

- **Site URL:** `http://localhost:3000`
- **Redirect URLs:** `http://localhost:3000/**`

The default "Confirm signup" email template uses the PKCE flow, so the link only
works in the browser that created the account. To make confirmation links work on
any device, use this template instead (Dashboard → Authentication → Emails):

```html
<h2>Confirm your signup</h2>
<p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/setup">Confirm your email</a></p>
```

## Auth routes

| Route | Purpose |
| --- | --- |
| `/auth/confirm` | Verifies email links (`token_hash`, `?code=`, or `#access_token`) and signs the user in |
| `/auth/callback` | Server-side fallback for `?code=` links; forwards failures to `/auth/error` |
| `/auth/error` | Friendly explanation when a link is expired, already used, or opened on another device |
