import { createClient } from '@/lib/supabase/server'

export async function getHeadOfficeActor() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'unauthorized' as const, user: null }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id,role_code,is_active')
    .eq('id', user.id)
    .maybeSingle()

  if (!profile?.is_active) return { error: 'inactive' as const, user: null }
  if (profile.role_code !== 'head_office') return { error: 'forbidden' as const, user: null }
  return { error: null, user }
}
