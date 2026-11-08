import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export default async function DashboardRedirect() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role_code,is_active')
    .eq('id', user.id)
    .maybeSingle()

  if (!profile) redirect('/setup')
  if (!profile.is_active) redirect('/sign-in?disabled=1')
  redirect(profile.role_code === 'head_office' ? '/admin' : '/workspace')
}
