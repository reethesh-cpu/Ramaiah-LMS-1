import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * A person can report to more than one manager. Accepts either an array of
 * ids or a single id (kept for older callers) and returns clean, unique ids.
 */
export function normalizeManagerIds(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]
  return Array.from(new Set(
    raw
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter(Boolean),
  ))
}

/**
 * Confirms every requested manager exists, is active, and is not the person
 * whose reporting line is being edited.
 */
export async function validateManagers(
  admin: SupabaseClient,
  managerIds: string[],
  profileId?: string,
): Promise<{ error: string | null; ids: string[] }> {
  const ids = Array.from(new Set(managerIds))
  if (profileId && ids.includes(profileId)) return { error: 'A person cannot report to themselves.', ids: [] }
  if (ids.length === 0) return { error: null, ids: [] }

  const { data, error } = await admin.from('profiles').select('id,is_active').in('id', ids)
  if (error) return { error: 'Reporting managers could not be verified.', ids: [] }

  const activeIds = new Set((data ?? []).filter((row) => row.is_active).map((row) => row.id as string))
  if (ids.some((id) => !activeIds.has(id))) return { error: 'Choose active reporting managers.', ids: [] }

  return { error: null, ids }
}

/**
 * Makes the profile_managers rows for a person match the requested managers.
 * Only the rows that actually change are written.
 */
export async function replaceProfileManagers(
  admin: SupabaseClient,
  profileId: string,
  managerIds: string[],
): Promise<{ error: string | null }> {
  const desired = Array.from(new Set(managerIds))

  const { data: existing, error: readError } = await admin
    .from('profile_managers')
    .select('manager_id')
    .eq('profile_id', profileId)
  if (readError) return { error: 'Reporting links could not be loaded.' }

  const current = new Set((existing ?? []).map((row) => row.manager_id as string))
  const toAdd = desired.filter((managerId) => !current.has(managerId))
  const toRemove = Array.from(current).filter((managerId) => !desired.includes(managerId))

  if (toAdd.length > 0) {
    const { error } = await admin
      .from('profile_managers')
      .insert(toAdd.map((managerId) => ({ profile_id: profileId, manager_id: managerId })))
    if (error) return { error: 'Reporting links could not be saved.' }
  }

  if (toRemove.length > 0) {
    const { error } = await admin
      .from('profile_managers')
      .delete()
      .eq('profile_id', profileId)
      .in('manager_id', toRemove)
    if (error) return { error: 'Reporting links could not be saved.' }
  }

  return { error: null }
}
