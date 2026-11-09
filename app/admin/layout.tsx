import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { AppShell } from '@/components/crm/app-shell'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Prevent the browser from caching authenticated pages.
  // Without this, pressing the back button after sign-out shows a stale cached page.
  const headerStore = await headers()
  void headerStore // accessing headers opts the route into dynamic rendering

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in')

  const { data: profile } = await supabase.from('profiles').select('full_name,email,role_code,is_active').eq('id', user.id).maybeSingle()
  if (!profile) redirect('/setup')
  if (!profile.is_active) redirect('/sign-in?disabled=1')
  if (profile.role_code !== 'head_office') redirect('/workspace')

  return <AppShell profile={profile} isAdmin>{children}</AppShell>
}
