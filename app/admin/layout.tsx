import { redirect } from 'next/navigation'
import { AppShell } from '@/components/crm/app-shell'
import { createClient } from '@/lib/supabase/server'

export default async function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in')

  const { data: profile } = await supabase.from('profiles').select('full_name,email,role_code,is_active').eq('id', user.id).maybeSingle()
  if (!profile) redirect('/setup')
  if (!profile.is_active) redirect('/sign-in?disabled=1')
  if (profile.role_code !== 'head_office') redirect('/workspace')

  return <AppShell profile={profile} isAdmin>{children}</AppShell>
}
